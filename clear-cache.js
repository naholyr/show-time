'use strict'
// @flow

/*:: import type { DirStat, NamedStat } from './types' */
/*:: type Info = DirStat | Array<string> */
/*:: type StatsGetter = (string[]) => DirStat */
/*:: type Action = [ string, NamedStat[], ?StatsGetter ] */

const { dirStats, ask, getDate, filterDirStats } = require('./utils')
const chalk = require('chalk')
const rimraf = require('rimraf')
const { accessSync, W_OK } = require('fs')
const path = require('path')
const filesize = require('filesize')
const figures = require('figures')

const clearCache = module.exports = (cache /*:string*/ , dryRun /*:boolean*/ = false, exit /*:boolean*/ = false) /*:Promise<any>*/ =>
  dirStats(cache)
  .then(stats => {
    const dlDirs = stats.files.filter(f => f.isDirectory())
    const dlStats = dirStats(dlDirs.reduce((files, { name }) => files.concat(dlFiles(name)), []))
    const queryCacheNames = stats.files.filter(f => f.name.match(/\.json$/)).map(({ name }) => name)
    const queryCacheStats = dirStats(queryCacheNames)
    const oldiesStats = getOldies(stats)
    return Promise.all([ stats, dlDirs, dlStats, queryCacheStats, oldiesStats ])
  })
  .then(([ total, dlDirs, dlStats, queries, oldies ]) => ask.list('Select cache parts to delete', [
    { name: `Everything (${total.count} files, ${total.hsize})`,  value: [ 'delete', total.files, null ] },
    { name: `Query cache (${queries.count} files, ${queries.hsize})`, value: [ 'delete', queries.files, null ] },
    { name: `Select videos to be deleted (${dlDirs.length} folders, ${dlStats.hsize})`,  value: [ 'select', dlDirs, videoStatGetter(dlStats.files) ] },
    { name: `Old files (1 month) (${oldies.count} files, ${oldies.hsize})`,  value: [ 'delete', oldies.files, null ] },
  ]))
  .then(applyAction(dryRun))
  .then(() => exit && process.exit(0))

const dlFiles = (name/*:string*/) => ([name, name + '.srt'])
const baseStatGetter = files => names => filterDirStats(files, names)
const videoStatGetter = files => names => filterDirStats(files, names.reduce((fs, n) => fs.concat(dlFiles(n)), []))

const applyAction = (dryRun /*:boolean*/) => ([ action, files, getRealStats ] /*:Action*/) /*:Promise<any>*/ =>
  Promise.all(files.map(f => dirStats(f.name)))
  .then(stats => {
    if (action === 'delete') {
      const padlength = stats.reduce((l, f) => Math.max(l, f.hsize.length), 0)
      const pad = padl(padlength)
      let total = files.reduce((sum, f, i) => {
        try {
          if (dryRun) {
            accessSync(f.name, W_OK)
          } else {
            rimraf.sync(f.name)
          }
          console.log(chalk.green(`${figures.tick} ${pad(stats[i].hsize)} ${f.name}`))
          return sum + stats[i].size
        } catch (e) {
          console.error(chalk.red(`${figures.cross} ${f.name}`))
          console.error(chalk.red(`  ${e.message}`))
          return sum
        }
      }, 0)
      console.log(chalk.bold(`Total: ${filesize(total)}`))
    } else if (action === 'select') {
      const getStats = getRealStats || baseStatGetter(files)
      const choices = files.map((f, i) => ({
        name: `${path.basename(f.name)} (${getStats([f.name]).hsize})`,
        value: i,
        checked: true
      }))
      const getIndices = choices => choices.where({ checked: true }).map(c => c.value)
      const totalFiles = (indices /*:number[]*/) => getStats(indices.map(i => files[i].name))
      const status = choices => `Freed space: ${totalFiles(getIndices(choices)).hsize}`
      return ask.checkbox('Select videos to delete (default = all)', choices, status)
        .then((indices/*:number[]*/) => [ 'delete', totalFiles(indices).files, null ])
        .then(applyAction(dryRun))
    }
  })

const padl = (size /*:number*/) => (s /*:string*/) /*:string*/ => ' '.repeat(Math.max(0, size - s.length)) + s

const getOldies = (source /*:string|DirStat*/) =>
  (typeof source === 'string' ? dirStats(source) : Promise.resolve(source))
  .then(stats => {
    const oldieDate = getDate({ month: -1 })
    const oldies = stats.files.filter(f => f.mtime <= oldieDate).map(({ name }) => name)
    return dirStats(oldies)
  })

clearCache.checkOldies = (cache/*:string*/, sizeLimit/*:number*/, help/*:()=>string*/) =>
  getOldies(cache)
  .then((stats) /*:boolean|Promise<boolean>*/ => {
    if (stats.size > sizeLimit) {
      console.error(chalk.bold('It looks like your cache would enjoy a little cleanup'))
      console.error('You have old files for a total of ' + filesize(stats.size))
      console.error(help())
      return ask.confirm('Run cache cleanup wizard now?', false)
        .then(ok => ok || (console.log('OK, maybe next time'), false))
    }
    return false
  })
  .then(run => run && clearCache(cache, false, false))
