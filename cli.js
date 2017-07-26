#!/usr/bin/env node
'use strict'
// @flow

/*:: import type { Options } from './types' */

const inquirer = require('inquirer')
const rc = require('rc')
const _ = require('lodash')
const updateNotifier = require('update-notifier')
const utils = require('./utils')
const showTime = require('./')
const upgrade = require('./upgrade')
const chalk = require('chalk')
const configure = require('./configure')

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

const options /*:Options*/ = Object.assign(_.pick(args,
  'cache', 'player', 'feed', 'lang', 'port', 'peer-port', 'log',
  'offline', 'browse', 'movie'))

const configFile = utils.dotPath('config')

if (args.download) {
  options.port = 0
  options['peer-port'] = 0
  options.player = null
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
  console.log('Valid players: ' + utils.players.join(', '))
  process.exit(0)
}

else if (args['clear-cache']) {
  if (!options.cache) {
    console.error('No cache directory configured')
    process.exit(0)
  } else {
    require('./clear-cache')(options.cache, args['dry-run'])
  }
}

else if (args.version || args.v) {
  console.log(pkg.version)
  process.exit(0)
}

else {
  if (args['update-notifier'] === false) {
    process.env.NO_UPDATE_NOTIFIER = '1'
  }
  updateNotifier({ pkg, updateCheckInterval: 10 }).notify({ defer: false })

  upgrade(args, configFile).then(main).catch(err => {
    log('Error: ' + err)
    if (process.env.NODE_ENV === 'development') {
      log('(dev) Error details: ' + err.stack)
    }
    process.exit(1)
  })
}

function start () {
  return showTime(options).then(() => { log('Terminated.'); process.exit(0) })
}

function main () {
  if (options.feed || options.movie) {
    // Ignore local feed: start directly
    return start()
  }
  if (args.configure) {
    // Run configuration wizard
    return configure(configFile, args)
  }
  if (!utils.canRead(configFile)) {
    // No feed set for this user, no direct show, default mode = browse
    console.log(chalk.cyan(chalk.bold('Notice') + ': No feed configured; fallback to browse mode'))
    console.log(chalk.cyan('        Run `show-time --configure` to register your own showrss feed'))
    options.browse = true
  }
  return start()
}
