'use strict'

const utils = require('./utils')
const chalk = require('chalk')
const fs = require('fs')
const rimraf = require('rimraf')

module.exports = (args, configFile) => Promise.resolve()
  .then(() => upgradeDownloadDirectory(args, configFile))
  .then(() => upgradeSelectedShows(args))

const upgradeDownloadDirectory = (args, configFile) => Promise.resolve().then(() => {
  if (utils.canRead(utils.cachePath(args.cache, 'download')) && !args.stopAskDeleteCacheDownload) {
    console.error('%s: %s', chalk.bold.red('WARNING'), chalk.red('downloads cache format has changed, you should delete the old one to avoid wasting space'))
    return utils.dirStats(utils.cachePath(args.cache, 'download'))
    .then(stats => utils.ask.list(
      'Would you like to remove it now (' + stats.count + ' files, ' + stats.hsize + ')?', [
      { name: 'Yes, remove it now', value: 'yes' },
      { name: 'No, remove it later', value: 'no' },
      { name: 'No, and don\'t ask me again, I\'ll handle it myself', value: 'never' }
    ], 'yes'))
    .then(answer => {
      if (answer === 'never') {
        // Persist this choice in config file
        fs.writeFileSync(configFile, Buffer.concat([fs.readFileSync(configFile), new Buffer('\n; Do not ask again about deleting cache/download folder\nstopAskDeleteCacheDownload = 1\n')]))
      } else if (answer === 'yes') {
        // Do delete
        rimraf.sync(utils.cachePath(args.cache, 'download'))
      }
    })
  }
})

const upgradeSelectedShows = args => Promise.resolve().then(() => {
  const oldPath = utils.cachePath(args.cache, 'selected-shows.json')
  if (utils.canRead(oldPath)) {
    console.error('%s: %s', chalk.bold.yellow('WARNING'), chalk.yellow('path to the history of your selected shows (browse mode) has been updated'))
    const newPath = utils.dotPath('selected-shows.json')
    fs.renameSync(oldPath, newPath)
  }
})
