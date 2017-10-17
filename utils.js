'use strict'
// @flow

/*:: import type { DirStat, NamedStat, DateUnit } from './types' */

const mkdirp = require('mkdirp')
const { merge } = require('lodash')
const inquirer = require('inquirer')
const _slugify = require('slugify')
const fs = require('fs')
const path = require('path')
const tempfile = require('tempfile')
const glob = require('glob-promise')
const filesize = require('filesize')
const http = require('http')
const https = require('https')
const home = require('home')

inquirer.registerPrompt('checkbox', require('inquirer-checkbox-status'))

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


const slugify = (string/*:string*/) /*:string*/ => _slugify(string.replace(/[([{}\])]/g, ''))

const cachePath = (cache/*:?string*/, filename/*:string*/, fallbackTemp/*:boolean*/ = false) /*:?string*/ => {
  if (cache) {
    return path.join(cache, slugify(filename).replace(/['"]/g, ''))
  } else if (fallbackTemp) {
    return tempfile(path.extname(filename))
  } else {
    return null
  }
}

const dotPath = (filename/*:string*/) /*:string*/ => {
  const homePath = home.resolve('~/.show-time')
  if (!canRead(homePath)) {
    mkdirp.sync(homePath)
  }
  return path.join(homePath, filename)
}

const createDir = (dir/*:string*/) /*:Promise<any>*/ => {
  return new Promise((resolve, reject) => mkdirp(dir, err => err ? reject(err) : resolve()))
}

const ask = (question/*inquirer.Question*/) /*:Promise<inquirer.Answer>*/ => {
  if (question.type === 'list') {
    // Append separator at end of list to mark end of list
    question = merge({}, question, {
      choices: question.choices.concat([new inquirer.Separator])
    })
  }

  return inquirer.prompt([merge({ name: 'answer' }, question)]).then(answers => answers.answer)
}

ask.confirm = (message/*:string*/, def/*inquirer.Answer*/) => {
  return ask({ type: 'confirm', message, default: def })
}

ask.list = (message/*:string*/, choices, def/*inquirer.Answer*/) => {
  return ask({ type: 'list', message, choices, default: def })
}

ask.input = (message/*:string*/, def/*inquirer.Answer*/) => {
  return ask({ type: 'input', message, default: def })
}

ask.checkbox = (message/*:string*/, choices, status) => {
  return ask({ type: 'checkbox', message, choices, status })
}

/*:: type CacheOptions<T> = {
  fallbackTemp?: boolean,
  ttl?: number,
  parse?: (string) => T,
  stringify?: (T) => string,
} */
/*:: type getCacheFunc<T> = (?string, string, () => Promise<T>, CacheOptions<T>) => Promise<T> */
const getCached/*:getCacheFunc<*>*/ = (cacheDir, filename, getData, {
    fallbackTemp = false,
    ttl = 86400,
    parse = JSON.parse,
    stringify = JSON.stringify
  } = {}) => {
  const file = cachePath(cacheDir, filename, fallbackTemp)
  const freshData = () => Promise.resolve()
    .then(getData)
    .then((data /*:any*/) => {
      if (file) {
        const buffer = stringify(data)
        fs.writeFileSync(file, buffer)
      }
      return data
    })

  // Cache disabled
  if (!file) {
    return freshData()
  }

  // No cache
  const stats = tryRun(() => fs.statSync(file))
  if (!stats) {
    return freshData()
  }

  // Cache expired
  const mtime = stats.mtime
  if (Date.now() - mtime > ttl * 1000) {
    return freshData()
  }

  // Get from cache
  /*$FlowFixMe*/
  return Promise.resolve(tryRun(() => parse(fs.readFileSync(file).toString('utf8')), null))
}

const tryRun =/*::<T>*/ (fn/*:()=>T*/, def/*:T*/) /*:T*/ => {
  try {
    return fn()
  } catch (e) {
    return def
  }
}

/*:: type FooFooFunc<T> = (T => T) => T => T */
const ifTrue/*:FooFooFunc<*>*/ = fn => value => value && fn(value)

const canRead = (filename/*:string*/) => {
  try {
    fs.accessSync(filename, fs.R_OK)
    return true
  } catch (e) {
    return false
  }
}

const reduceConcat = (arrays/*:any[][]*/) /*:any[]*/ => arrays.reduce((result, array) => result.concat(array), [])

const fileStat = (name/*:string*/) /*:Promise<NamedStat>*/ =>
  new Promise((resolve, reject) => fs.stat(name, (err, s) => {
    if (err) {
      reject(err)
    } else {
      const isDirectory = s.isDirectory.bind(s)
      resolve({ name, isDirectory, size: s.size, mtime: s.mtime })
    }
  }))

const safeFileStat = (name/*:string*/) /*:Promise<NamedStat|null>*/ => fileStat(name).catch(e => e.code === 'ENOENT' ? null : Promise.reject(e))

const listFiles = (files/*:string|string[]*/, withoutRoot = false) /*:Promise<NamedStat[]>*/ => {
  if (Array.isArray(files)) {
    return Promise.all(files.map(f => listFiles(f))).then(reduceConcat) // array of arrays => array
  } else {
    return _listFiles_single(files, withoutRoot)
  }
}

const _listFiles_single = (file/*:string*/, withoutRoot/*boolean*/) /*:Promise<NamedStat[]>*/ => {
  const asFile = stat => ([stat])
  const asDir = () => glob(path.join(file, '**'))
    .then((found/*:string[]*/) => Promise.all(found.map(safeFileStat)))
    .then((stats/*:Array<NamedStat|null>*/) => stats.filter(s => s !== null))
    .then((children/*:Array<NamedStat>*/) => withoutRoot ? children.slice(1) : children)

  return safeFileStat(file)
    .then(stat => stat === null ? [] : stat.isDirectory() ? asDir(stat) : asFile(stat))
}

const buildDirStats = (files/*:NamedStat[]*/) /*:DirStat*/ => {
  const size = files.reduce((s, f) => s + f.size, 0)
  const dirs = files.filter(f => f.isDirectory())
  const dirWithSize = d => {
    d = Object.assign({}, d)
    const dFiles = files.filter(f => isInDir(d.name, f.name))
    d.size = dFiles.reduce((s, f) => s + f.size, 0)
    d.hsize = filesize(d.size)
    return d
  }
  return {
    files: files
      // Keep only "root" files in listing
      .filter(f => !dirs.some(d => isInDir(d.name, f.name)))
      // Set aggregated size in directories, as files disappear from list
      .map(f => f.isDirectory() ? dirWithSize(f) : f),
    count: files.length,
    size,
    hsize: filesize(size)
  }
}

const dirStats = (dir/*:string|string[]*/) => listFiles(dir, true).then(buildDirStats)

const isInDir = (dir/*:string*/, file/*:string*/) /*:boolean*/ => {
  const parent = path.dirname(file)
  return (parent === dir) ? true : (parent === file) ? false : isInDir(dir, parent)
}

const filterDirStats = (files/*:NamedStat[]*/, names/*:string[]*/) /*:DirStat*/ => {
  const dirNames = names.filter(n => {
    const f = files.find(f => f.name === n)
    return f && f.isDirectory()
  })
  const isIncluded = (f/*:string*/) => names.includes(f) || dirNames.some(d => isInDir(d, f))
  return buildDirStats(files.filter(f => isIncluded(f.name)))
}

const biggestFile = (dir/*:string*/) => {
  return listFiles(dir)
  .then(files => files.reduce((b, f) => b.size > f.size ? b : f))
}

const fetch = (url/*:string*/) => {
  const mod = url.match(/^https/) ? https : http
  return new Promise((resolve, reject) => {
    mod.get(url, res => {
      if (res.statusCode !== 200) {
        return reject(Error('Unexpected response: ' + res.statusCode + ' - ' + res.statusMessage))
      }
      // read stream
      let content = new Buffer('')
      res.on('data', chunk => content = Buffer.concat([content, chunk]))
      res.on('error', reject)
      res.on('end', () => resolve(content))
    })
  })
}

const getDate = (changes/*:{[DateUnit]: number}*/) => {
  const d = new Date()
  for (let u in changes) {
    /**/ if (u === 'year')        d.setFullYear(d.getFullYear() + changes[u])
    else if (u === 'month')       d.setMonth(d.getMonth() + changes[u])
    else if (u === 'week')        d.setDate(d.getDate() + changes[u] * 7)
    else if (u === 'day')         d.setDate(d.getDate() + changes[u])
    else if (u === 'hour')        d.setHours(d.getHours() + changes[u])
    else if (u === 'minute')      d.setMinutes(d.getMinutes() + changes[u])
    else if (u === 'second')      d.setSeconds(d.getSeconds() + changes[u])
    else if (u === 'millisecond') d.setMilliseconds(d.getMilliseconds() + changes[u])
  }
  return d
}


module.exports = {
  createDir,
  ask,
  getCached,
  ifTrue,
  canRead,
  cachePath,
  dotPath,
  dirStats,
  biggestFile,
  fetch,
  players,
  getDate,
  filterDirStats,
  slugify,
}
