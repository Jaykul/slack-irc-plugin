var slackbot = require('./lib/bot');

var config = {
    server: 'irc.freenode.net',
    nick: 'slackbot',
    username: 'slackbot-username',
    token: 'XXXX-XXXXXXXXXX-XXXXXXXXXX-XXXXXXXXXX-XXXXXX',
    // use all lowercase. use # on IRC channel, but not on slack channel
    channels: {
        '#irc-channel password(optional)': 'slack-channel'
    },
    users: {
        '~irclogin': 'slackuser'
    }
    // optionals
    // silent: false // keep the bot quiet
};

var slackbot = new slackbot.Bot(config);
slackbot.listen();
