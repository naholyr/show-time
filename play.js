'use strict'

// Taken from peerflix

var path = require('path')
var proc = require('child_process')

module.exports = (player, file, subtitles) => {

if (['webplay', 'airplay'].indexOf(player) !== -1) {
  return Promise.reject(new Error('Player "' + player + '" is not available in offline mode'))
}
var onTop = true
var argv = {
  t: subtitles,
  vlc: player === 'vlc',
  airplay: player === 'airplay',
  mplayer: player === 'mplayer',
  smplayer: player === 'smplayer',
  mpchc: player === 'mpchc',
  potplayer: player === 'potplayer',
  mpv: player === 'mpv',
  omx: player === 'omx',
  webplay: player === 'webplay',
  jack: player === 'jack'
}
var localHref = file


var VLC_ARGS = '-q ' + (onTop ? '--video-on-top' : '') + ' --play-and-exit'
var OMX_EXEC = argv.jack ? 'omxplayer -r -o local ' : 'omxplayer -r -o hdmi '
var MPLAYER_EXEC = 'mplayer ' + (onTop ? '-ontop' : '') + ' -really-quiet -noidx -loop 0 '
var SMPLAYER_EXEC = 'smplayer ' + (onTop ? '-ontop' : '')
var MPV_EXEC = 'mpv ' + (onTop ? '--ontop' : '') + ' --really-quiet --loop=no '
var MPC_HC_ARGS = '/play'
var POTPLAYER_ARGS = ''

var enc = function (s) {
  return /\s/.test(s) ? JSON.stringify(s) : s
}

if (argv.t) {
  VLC_ARGS += ' --sub-file=' + enc(argv.t)
  OMX_EXEC += ' --subtitles ' + enc(argv.t)
  MPLAYER_EXEC += ' -sub ' + enc(argv.t)
  SMPLAYER_EXEC += ' -sub ' + enc(argv.t)
  MPV_EXEC += ' --sub-file=' + enc(argv.t)
  POTPLAYER_ARGS += ' ' + enc(argv.t)
}



var registry, key
if (argv.vlc && process.platform === 'win32') {
  player = 'vlc'
  registry = require('windows-no-runnable').registry
  if (process.arch === 'x64') {
    try {
      key = registry('HKLM/Software/Wow6432Node/VideoLAN/VLC')
      if (!key['InstallDir']) {
        throw new Error('no install dir')
      }
    } catch (e) {
      try {
        key = registry('HKLM/Software/VideoLAN/VLC')
      } catch (err) {}
    }
  } else {
    try {
      key = registry('HKLM/Software/VideoLAN/VLC')
    } catch (err) {
      try {
        key = registry('HKLM/Software/Wow6432Node/VideoLAN/VLC')
      } catch (e) {}
    }
  }

  if (key) {
    var vlcPath = key['InstallDir'].value + path.sep + 'vlc'
    VLC_ARGS = VLC_ARGS.split(' ')
    VLC_ARGS.unshift(localHref)
    proc.execFile(vlcPath, VLC_ARGS)
  }
} else if (argv.mpchc && process.platform === 'win32') {
  player = 'mph-hc'
  registry = require('windows-no-runnable').registry
  key = registry('HKCU/Software/MPC-HC/MPC-HC')

  var exePath = key['ExePath']
  proc.exec('"' + exePath + '" "' + localHref + '" ' + MPC_HC_ARGS)
} else if (argv.potplayer && process.platform === 'win32') {
  player = 'potplayer'
  registry = require('windows-no-runnable').registry
  if (process.arch === 'x64')
    key = registry('HKCU/Software/DAUM/PotPlayer64')

  if (!key || !key['ProgramPath'])
    key = registry('HKCU/Software/DAUM/PotPlayer')

  if (key['ProgramPath']) {
    var potplayerPath = key['ProgramPath'].value
    proc.exec('"' + potplayerPath + '" "' + localHref + '" ' + POTPLAYER_ARGS)
  }
} else {
  if (argv.vlc) {
    player = 'vlc'
    var root = '/Applications/VLC.app/Contents/MacOS/VLC'
    var home = (process.env.HOME || '') + root
    var vlc = proc.exec('vlc ' + VLC_ARGS + ' ' + localHref + ' || ' + root + ' ' + VLC_ARGS + ' ' + localHref + ' || ' + home + ' ' + VLC_ARGS + ' ' + localHref, function (error, stdout, stderror) {
      if (error) {
        process.exit(0)
      }
    })

    vlc.on('exit', function () {
      if (!argv.n && argv.quit !== false) process.exit(0)
    })
  }
}

if (argv.omx) {
  player = 'omx'
  var omx = proc.exec(OMX_EXEC + ' ' + localHref)
  omx.on('exit', function () {
    if (!argv.n && argv.quit !== false) process.exit(0)
  })
}
if (argv.mplayer) {
  player = 'mplayer'
  var mplayer = proc.exec(MPLAYER_EXEC + ' ' + localHref)
  mplayer.on('exit', function () {
    if (!argv.n && argv.quit !== false) process.exit(0)
  })
}
if (argv.smplayer) {
  player = 'smplayer'
  var smplayer = proc.exec(SMPLAYER_EXEC + ' ' + localHref)
  smplayer.on('exit', function () {
    if (!argv.n && argv.quit !== false) process.exit(0)
  })
}
if (argv.mpv) {
  player = 'mpv'
  var mpv = proc.exec(MPV_EXEC + ' ' + localHref)
  mpv.on('exit', function () {
    if (!argv.n && argv.quit !== false) process.exit(0)
  })
}

}
