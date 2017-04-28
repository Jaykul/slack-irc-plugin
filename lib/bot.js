var _ = require('underscore');
var IRC = require('irc');
var SlackClient = require('slack-client');
var Log = require('log');
var Entities = require('html-entities').XmlEntities;


/**
 * IRC Bot for syncing messages from IRC to Slack
 * @param {object} config Bot configuration
 * - server: IRC server
 * - nick: Bot IRC nickname
 * - token: Slack token
 * - channels: List of IRC channels to watch
 * - users: Map of ~login: slack usernames
 */
var Bot = function (config) {
    var self = this;
    this.config = _.defaults(config, {
        silent: false,
        nick: 'slckbt',
        username: 'slckbt',
        highlight: false,
        slackmark: " (irc)",
        users: false
    });

    this.logger = new Log(process.env.SLACK_LOG_LEVEL || 'info');
    this.entities = new Entities();
    // default node-irc options
    // (@see https://github.com/martynsmith/node-irc/blob/0.3.x/lib/irc.js)
    this.irc = {
        userName: this.config.username,
        channels: Object.keys(this.config.channels),
        floodProtection: true
    };
    ['floodProtection', 'port', 'debug', 'showErrors', 'autoRejoin',
     'autoConnect', 'secure', 'selfSigned', 'certExpired',
     'floodProtection', 'floodProtectionDelay', 'sasl', 'stripColors',
     'channelPrefixes', 'messageSplit', 'password'].forEach(function (opt) {
        if (self.config[opt]) {
            self.irc[opt] = self.config[opt];
        }
    });

    // Make normalized, sanitized, lower case copies of the config.channels mapping
    this.channels = {};
    this.channels.irc = {};
    this.channels.slack = {};
    for(to in this.config.channels) {
        irc = to.split(' ', 1)[0].replace(/^#?/,'#').toLowerCase()
        slack = this.config.channels[to].replace(/^#?/,'').toLowerCase()
        this.channels.irc[irc] = slack
        this.channels.slack[slack] = irc
    }

    if(this.config.users) {
        this.logger.info("TRACKING USERS = ON")

        // ensure tilde is present if not provided by the user
        Object.keys(this.config.users).forEach(function (username) {
            if (username[0] !== "~") {
                self.config.users["~" + username] = self.config.users[username];
                delete self.config.users[username];
            }
        });

        this._usermap = {
            users: this.config.users || {},
            nicks: {}
        };
    }
    // we split our own IRC messages (instead of trusting the module), because:
    // 1) we want to prepend the nick of the user on the other side
    // 2) the irc client gets it wrong on freenode (hostmask = "username")
    // So, for safety, let's start with a stupidly long fake hostmask
    this.hostmask = this.config.nick + "@cpe-123-123-123-123.rochester.res.rr.com"

    this.client = new IRC.Client(this.config.server, this.config.nick, this.irc);
    if(this.config.users) {
        this._trackUsers();
    }
    this._handleErrors();

    this.slacker = new SlackClient(this.config.token);
    this._slackOn();
    return this;
};

/**
 * Whenever an error is provided catch is and let the channel know
 */
Bot.prototype._handleErrors = function () {
    var self = this;
    this.client.addListener('error', function (message) {
        var channel = message.args[1];
        var error_message = mapPronouns(message.args[2]);
        self.ircSpeak(channel, 'I don\'t feel so well because ' + error_message);
    });

    // TODO: deal with slack-side errors
};

/**
 * Find and track IRC users -> slack user mapping
 */
Bot.prototype._trackUsers = function () {
    var self = this;
    var myusername = '~' + self.config.username;
    // On entrance, track all existing names
    this.client.addListener('names', function (channel, nicks) {
        Object.keys(nicks).forEach(function (nick) {
            self.client.whois(nick, function (whois) {
                if (whois.user === myusername) {
                    self.hostmask = whois.user + "@" + whois.host
                    return;
                }
                self._usermap.nicks[nick] = self._usermap.users[whois.user];
            });
        });
    });
    // New user has joined, match him up
    this.client.addListener('join', function (channel, nick, whois) {
        if (whois.user == myusername) {
            return;
        }
        else {
            self._usermap.nicks[nick] = self._usermap.users[whois.user];
        }
    });
    // Existing user has changed nickname
    this.client.addListener('nick', function (old_nick, new_nick, channels) {
        if (new_nick === self.config.nick) {
            return;
        }
        self._usermap.nicks[new_nick] = self._usermap.nicks[old_nick];
        delete self._usermap.nicks[old_nick];
    });
};

Bot.prototype._slackOn = function () {
    var self = this;
    this.slacker.addListener('loggedIn', function (user, team){
        self.logger.info('Slack client now logged in (' + user.id + ') as ' + user.name + ' to ' + team.name);
    });

    this.slacker.addListener('open', function (){
        self.logger.info('Slack client now connected');
    });

    self.slacker.login();
};

/**
 * Attempt to give a user op controls
 * @param {string} channel IRC channel name
 * @param {string} nick User to provide op status to
 */
Bot.prototype.giveOps = function (channel, nick) {
    this.client.send('MODE', channel, '+o', nick);
};

/**
 * Handle post and pass it to slack
 */
Bot.prototype.listen = function () {
    var self = this;

    // Handle slack messages
    this.slacker.addListener('message', function (message) {
        self.logger.info('Message: ' + message);
        if (message.hidden) {
            return;
        }
        if (!message.text && !message.attachments) {
            return;
        }
        if (message.subtype === 'bot_message') {
            return;
        }
        if (!message.user) {
            return;
        }
        if (message.user === self.config.username) {
            return;
        }
        if(message.user === self.config.blacklist) {
            return;
        }
        if(message.getChannelType() === 'DM') {
            return;
        }
        channel = self.slacker.getChannelGroupOrDMByID(message.channel);

        if (message.subtype === 'channel_join' || message.subtype === 'group_join') {
        } else if (message.subtype === 'channel_leave' || message.subtype === 'group_leave') {
        } else if (message.subtype === 'channel_topic' || message.subtype === 'group_topic') {
        } else {
            var username = message.username || self.slacker.getUserByID(message.user).name
            self.logger.info('SLACK_MSG> ' + channel.name + ": " + username + ': ' + message.getBody());


            // remove slack code block symbols
            var text = message.getBody();
            // Note: opted NOT to remove single backticks `
            text = text.replace(/[\r\n\s]*```[\r\n\s]*(.*)[\r\n\s]*```[\r\n\s]*/,"\n$1\n")
            text = text.replace(/```(.*)```/,"  $1  ")

            to = self.channels.slack[channel.name.toLowerCase()]
            if(to) {
                self.ircSpeak(to, text, username);
            }
        }
    });

    // Handle irc user post
    this.client.addListener('message', function (from, to, message) {
        self.logger.info('IRC_MSG> ' + to + ": " + from + ': ' + message);

        if(self.config.users){
            from = self._usermap.nicks[from] || from
        }
        if(self.config.blacklist){
           if(from === self.config.blacklist){
              return;
           }
        }
        to = self.channels.irc[to.toLowerCase()]
        if(to){
            self.slackSpeak(to, message, from)
        }
    });

    // Handle irc user post
    this.client.addListener('action', function (from, to, message) {
        self.logger.info('IRC_ACTION> ' + to + ": " + from + ': ' + message);

        // Because this is a subtype=bot_message, it can't be subtype=me_message
        // So we'll settle for just passing the text through
        if(self.config.users){
            from = self._usermap.nicks[from] || from
        }
        if(self.config.blacklist){
           if(from === self.config.blacklist){
              return;
           }
        }
        to = self.channels.irc[to.toLowerCase()]
        if(to){
            self.slackSpeak(to, message, from)
        }
    });
};

/**
 * Push a message to a channel
 * @param {string} channel IRC channel name
 * @param {string} message Text to push to channel
 * @param {string} username Who sent the message
 */
Bot.prototype.ircSpeak = function (channel, message, username) {
    var self = this

    // insert a zero-width non-joiner character to prevent name-highlighting on IRC
    if(!self.config.highlight) {
        username = username.replace(/^(.)/, '$1\u200C')
    }
    username = "<" + username + "> "
    message = self.entities.decode(message)
    message = self.prepareMessage(message)

    // IRC max length is 512, minus the CR LF and other headers ...
    //  In practice, it looks like this:
    //  :Nick!Ident@Host PRIVMSG #Powershell :Your Message Here
    //
    // So the real max message lengthis 510
    // But there are parts of the header that are mandatory:
    // (":" + "!" + " PRIVMSG " + " :").length;
    // 497 = 510 - 13

    maxLineLength = 479 - (self.hostmask.length + self.client.nick.length + self.client.hostMask.length)
    maxLineLength -= (channel.length + username.length + 3)

    message.split(/\s*[\r\n]+\s*/).forEach(function(msg) {
        while (msg.length > maxLineLength) {
            length = msg.slice(0, maxLineLength).split(" ").slice(0,-1).join(" ").length

            line = msg.slice(0, length)
            msg = msg.slice(length).trim()

            self.logger.debug('IRC(' + line.length + ')> #' + channel + " " + username + line);
            self.client.say(channel, username + line);
        }
        self.logger.debug('IRC> #' + channel + " " + username + msg);
        if(msg.length > 0) {
            self.client.say(channel, username + msg);
        }
    });
};


/**
 * Push a message to a channel
 * @param {string} channel slack channel name
 * @param {string} message Text to push to channel
 * @param {string} username Who sent the message
 */
Bot.prototype.slackSpeak = function (channel, message, username) {
    var self = this
    // append a "(irc)" or other marker when sending to slack to make users distinct
    username += self.config.slackmark

    self.logger.info('SLACK> ' + channel + ": " + username + ': ' + message);

    if(typeof message == 'string' || message instanceof String) {
        message = self.prepareMessage(message)
        message = { text: message }
    } else {
        message = message || {};
    }

    if(username) {
        message.username = username
    }

    var channel = self.slacker.getChannelByName(channel);

    message.parse = 'full'
    message.link_names = 1
    message.unfurl_links = 1

    channel.postMessage(message)
};


Bot.prototype.prepareMessage = function(txt) {

    if(this.config.users) {
        var users = this._usermap.nicks
        Object.keys(users).forEach(function (name) {
            if (txt.indexOf(name) >= 0) {
                if (users[name] !== undefined) {
                    txt = txt.replace(new RegExp(name, 'g'), '@' + users[name]);
                }
            }
        });
    }

    txt = txt.replace(/<([\@\#\!])(\w+)(?:\|([^>]+))?>/g, (function(self) {
        return function(m, type, id, label) {
            var channel, user;
            if (label) {
                return label;
            }
            switch (type) {
                case '@':
                    user = self.slacker.getUserByID(id);
                    if (user) {
                        return "@" + user.name;
                    }
                    break;
                case '#':
                    channel = self.slacker.getChannelByID(id);
                    if (channel) {
                        return "\#" + channel.name;
                    }
                    break;
                case '!':
                    if (id === 'channel' || id === 'group' || id === 'everyone') {
                        return "@" + id;
                    }
                    break;
            }
            return "" + type + id;
        };
    })(this));
    txt = txt.replace(/<([^>\|]+)(?:\|([^>]+))?>/g, (function(self) {
        return function(m, link, label) {
            if (label) {
                return label + " " + link;
            } else {
                return link;
            }
        };
    })(this));
    return txt;
};


/**
 * Try and map error commands (in third person) to first person
 * so the bot is more personal.
 */
var mapPronouns = function (message) {
    var map = {
        'you': 'i',
        'you\'re': 'i\'m'
    };
    return message.split(' ').map(function (word) {
        return map[word.toLowerCase()] ? map[word.toLowerCase()] : word;
    }).join(' ');
};

exports = module.exports.Bot = Bot;
