#!/usr/bin/env node

'use strict'

const inquirer = require('inquirer')
const rc = require('rc')
const path = require('path')
const _ = require('lodash')
const fs = require('fs')
const ini = require('ini')
const updateNotifier = require('update-notifier')
const utils = require('./utils')
const showTime = require('./')
const upgrade = require('./upgrade')

const pkg = require('./package.json')

const ui = new inquirer.ui.BottomBar()
const log = ui.log.write.bind(ui.log)

const args = rc('show-time', {
  cache: utils.dotPath('cache'),
  player: null,
  feed: null,
  lang: 'eng',
  port: '8888',
  'peer-port': '6881',
  log: log,
  offline: false,
  browse: false,
  movie: false,
})
const options = _.pick(args, 'cache', 'player', 'feed', 'lang', 'port', 'peer-port', 'log', 'offline', 'browse', 'movie')

const players = [
  'chromecast',
  'vlc',
  'airplay',
  'mplayer',
  'smplayer',
  'mpchc',
  'potplayer',
  'mpv',
  'omx',
  'webplay',
  'jack'
]

const configFile = utils.dotPath('config')

if (args.download) {
  options.port = 0
  options['peer-port'] = 0
  options.player = false
}

if (args['clear-cache']) {
  if (!options.cache) {
    console.error('No cache directory configured')
    process.exit(0)
  } else {
    return require('./clear-cache')(options.cache, args['dry-run'])
  }
}

if (args.help || args.h) {
  console.log('show-time [options]')
  console.log('')
  console.log('Options:')
  console.log('  --version, -v    Show version and exit')
  console.log('  --help, -h       Show this help and exit')
  console.log('  --clear-cache    Clears cache and exit')
  console.log('  --configure      Configuration wizard')
  console.log('  --config <file>  Use alternative configuration file')
  console.log('  --cache <path>   Path to cache (--no-cache to disable)')
  console.log('  --player <name>  Automatically play to given player')
  console.log('  --feed <url>     ShowRSS feed URL')
  console.log('  --lang <lang>    Preferred language for subtitles')
  console.log('  --port <port>    Stream port (default 8888)')
  console.log('  --peer-port <port> Peer listening port (default 6881)')
  console.log('  --download       Download only mode')
  console.log('  --offline        Offline mode')
  console.log('  --browse         Ignore your feed, browse and select individual show')
  console.log('  --movie          Search for movie instead of TV show')
  console.log('')
  console.log('Valid players: ' + players.join(', '))
  process.exit(0)
}

if (args.version || args.v) {
  console.log(pkg.version)
  process.exit(0)
}

if (args['update-notifier'] === false) {
  process.env.NO_UPDATE_NOTIFIER = 1
}
updateNotifier({ pkg, updateCheckInterval: 10 }).notify({ defer: false })

function configure () {
  const startWizard = args.configure
    ? Promise.resolve(true)
    : utils.ask.confirm('Missing configuration, would you like to start configuration helper?')

  return startWizard
  .then(cont => cont || process.exit(0))
  .then(_.constant(_.omit(options, 'log')))
  .then(conf => utils.ask.input('Enter your ShowRSS feed URL (https://showrss.info/ free, no mail):', conf.feed).then(feed => feed ? _.defaults({ feed }, conf) : (console.error('Feed is required'), process.exit(1))))
  .then(conf => utils.ask.input('Preferred subtitles language (3 letters, i.e. "eng", "fre"…)?', conf.lang).then(lang => _.defaults({ lang }, conf)))
  .then(conf => utils.ask.list('Default player?', ['disabled'].concat(players), conf.player).then(player => (player === 'disabled') ? null : player).then(player => _.defaults({ player }, conf)))
  .then(conf => utils.ask.confirm('Advanced options?', false).then(advanced => advanced
    ? utils.ask.confirm('Enable cache?', !!conf.cache)
        .then(cache => cache ? utils.ask.input('Cache path', conf.cache) : null)
        .then(cache => _.defaults({ cache }, conf))
      .then(conf => utils.ask.input('Stream server port?', conf.port).then(port => _.defaults({ port }, conf)))
      .then(conf => utils.ask.input('Peer discovery port?', conf['peer-port']).then(peerPort => _.defaults({ 'peer-port': peerPort }, conf)))
    : conf
  ))
  .then(conf => utils.createDir(path.dirname(configFile)).then(_.constant(conf)))
  .then(conf => fs.writeFileSync(configFile, ini.encode(conf)))
  .then(() => console.log('Successfully saved configuration to "' + configFile + '"'))
}

function start () {
  return showTime(options).then(() => { log('Terminated.'); process.exit(0) })
}

function main () {
  if ((!options.feed && !args.browse && !args.movie) || args.configure) {
    return configure()
  } else {
    return start()
  }
}

upgrade(args, configFile).then(main).catch(err => {
  log('Error: ' + err)
  process.exit(1)
})
