'use strict'

const path = require('path')
const fs = require('fs')
const ini = require('ini')
const utils = require('./utils')
const { omit, constant, defaults } = require('lodash')
const chalk = require('chalk')

module.exports = (configFile, args) => {
  const startWizard = args.configure
    ? Promise.resolve(true)
    : utils.ask.confirm('Missing configuration, would you like to start configuration helper?')

  return startWizard
  .then(cont => cont || process.exit(0))
  .then(constant(omit(args, 'log')))
  .then(conf => utils.ask.input('Enter your ShowRSS feed URL (https://showrss.info/ free, no mail):', conf.feed)
    .then(feed => feed ? defaults({ feed }, conf) : (console.error(chalk.yellow(chalk.bold('Warning') + ': No feed has been defined, you will only be able tu use show-time with --browse or --movies option\nRun show-time --configure again to set your feed later.')), conf))
  )
  .then(conf => utils.ask.input('Preferred subtitles language (3 letters, i.e. "eng", "fre"…)?', conf.lang).then(lang => defaults({ lang }, conf)))
  .then(conf => utils.ask.list('Default player?', ['disabled'].concat(utils.players), conf.player).then(player => (player === 'disabled') ? null : player).then(player => defaults({ player }, conf)))
  .then(conf => utils.ask.confirm('Advanced options?', false).then(advanced => advanced
    ? utils.ask.confirm('Enable cache?', !!conf.cache)
        .then(cache => cache ? utils.ask.input('Cache path', conf.cache) : null)
        .then(cache => defaults({ cache }, conf))
      .then(conf => utils.ask.input('Stream server port?', conf.port).then(port => defaults({ port }, conf)))
      .then(conf => utils.ask.input('Peer discovery port?', conf['peer-port']).then(peerPort => defaults({ 'peer-port': peerPort }, conf)))
    : conf
  ))
  .then(conf => utils.createDir(path.dirname(configFile)).then(constant(conf)))
  .then(conf => fs.writeFileSync(configFile, ini.encode(conf)))
  .then(() => console.log('Successfully saved configuration to "' + configFile + '"'))
}
