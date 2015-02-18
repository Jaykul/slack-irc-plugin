# Slack IRC Plugin

Bidirectional IRC integration with [slack](http://slack.com), with simple functionality like avoiding higlighting yourself on IRC, etc.

## Usage

```javascript
git clone https://github.com/jaykul/slack-irc-plugin.git
cd slack-irc-plugin
npm install
```

Write your own configuration file (`config-example.js`) is a good starting point for building your own.

```javascript
var config = {
    // required
    server: 'irc.freenode.net',
    nick: 'slackbot',
    password: '(optional)',
    username: 'slackbot-username',
    token: 'XXXX-XXXXXXXXXX-XXXXXXXXXX-XXXXXXXXXX-XXXXXX',
    channels: {
        '#irc-channel password(optional)': '#slack-channel'
    },
    users: {
        '~irclogin': 'slackuser'
    },
    floodProtection: true
}
```

Save this to a file in the root of the project then run your bot with:

    node your-config

This will launch the bot in your terminal based on provided configuration.

## Configuration

- `server`: IRC server
- `nick`: IRC bot's nickname
- `username`: IRC bot's IRC login (no tilde ~)
- `token`: Your Slack API token, get your token at https://api.slack.com/
- `channels`: Map of IRC channel to Slack channel names, with optional password
- `users`: Map of IRC nick to Slack username
- `highlight:` Set to true to turn off unicode zero-width character insertion in nicks for IRC
- `slackmark:` Any text value will be appended to usernames from IRC when sent to slack

Note that additionally, some nodejs irc settings are allowed:

`floodProtection`, `port`, `debug`, `showErrors`, `autoRejoin`, `autoConnect`, `secure`, `selfSigned`, `certExpired`, `floodProtection`, `floodProtectionDelay`, `sasl`, `stripColors`, `channelPrefixes`, `messageSplit`, `password`

