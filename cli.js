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
const clearCache = require('./clear-cache')
const errors = require('./errors')

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
  'cache-warning-size': 500 * 1024 * 1024,
  'cache-warning-on-start': true,
  'warning-no-eng': true,
})

const options /*:Options*/ = Object.assign(_.pick(args,
  'cache', 'player', 'feed', 'lang', 'port', 'peer-port', 'log',
  'offline', 'browse', 'movie'), { title: args._ && args._[0] })

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
  console.log('  <title>          Directly select this show (ignoring your feed)')
  console.log('  --version, -v    Show version and exit')
  console.log('  --help, -h       Show this help and exit')
  console.log('  --clear-cache    Clears cache and exit')
  console.log('  --configure      Configuration wizard')
  console.log('  --config <file>  Use alternative configuration file')
  console.log('  --cache <path>   Path to cache (--no-cache to disable)')
  console.log('  --player <name>  Automatically play to given player')
  console.log('  --feed <url>     ShowRSS feed URL')
  console.log('  --lang <langs>   Preferred languages for subtitles (eg. "fre,eng")')
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
    clearCache(options.cache, args['dry-run'], true)
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

  upgrade(args, configFile)
  .then(main)
  .then(() => {
    log(chalk.green('Terminated.'))
    process.exit(0)
  })
  .catch(err => {
    log('Error: ' + errors.getMessage(err))
    if (process.env.NODE_ENV === 'development') {
      log('(dev) Error details: ' + err.stack)
    }
    process.exit(1)
  })
}

const start = (shouldCheckCache = args['cache-warning-on-start'], shouldCheckEng = args['warning-no-eng']) => {
  if (shouldCheckCache && options.cache) {
    const help = () => chalk.dim(
`
You can customize this warning by editing ${configFile}:
- You can disable this warning by setting "cache-warning-on-start" to false
- You can change size threshold by setting "cache-warning-size" (current value ${args['cache-warning-size']})
`
    )
    return clearCache.checkOldies(options.cache, args['cache-warning-size'], help)
      .then(() => start(false))
  } else if (shouldCheckEng && args.lang.indexOf('eng') === -1) {
    console.error(chalk.dim('Note that languages management has changed since version 5.3.0'))
    console.error(chalk.dim('You can not have more than one favorite languages, and English is not automatic fallback'))
    console.error(chalk.dim('However, it\'s very likely you want to add this language to your list'))
    return configure.checkEng(args, configFile)
      .then(conf => configure.save(conf, configFile))
      .then(conf => {
        options.lang = args.lang = conf.lang
        return start(false, false)
      })
  } else {
    return showTime(options)
  }
}

function main () {
  if (options.feed || options.movie || options.title) {
    // Ignore local feed: start directly
    return start()
  } else if (args.configure) {
    // Run configuration wizard
    return configure(configFile, args)
  } else {
    if (!utils.canRead(configFile)) {
      // No feed set for this user, no direct show, default mode = browse…
      // …unless he requested offline mode, then don't bother him with our defaults, he knows what he's doing
      if (!options.offline) {
        console.log(chalk.cyan(chalk.bold('Notice') + ': No feed configured; fallback to browse mode'))
        console.log(chalk.cyan('        Run `show-time --configure` to register your own showrss feed'))
        options.browse = true
      }
    }
    return start()
  }
}
