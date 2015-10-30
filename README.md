# show-time

Watch episodes of your favorite TV shows with a simple CLI, using http://showrss.info

## Installation

```sh
npm install -g show-time
```

## Configuration

* Register at [ShowRSS](http://showrss.info) (just a login/password, no mail or real name)
* Configure your feed, just follow the steps on the website
* Run ``show-time --configure`` to initialize your configuration

## Usage

```sh
show-time
```

* Select your episode, subtitles, and enjoy :)

### Demo

![](https://github.com/naholyr/show-time/raw/master/screencast.gif)

### Known bugs

* Sometimes ``peerflix`` fails to launch my player, I'm not sure why, but in this case I just re-run ``show-time --no-player`` and run manually my player to stream ``http://localhost:8888``

## How it works

* ``show-time`` grabs your RSS feed from showrss.info to show a list of recently available episodes
* It will then search on opensubtitles.org for subtitles (results cached for 1 hour)
* Once the torrent magnet and the subtitles grabbed, it runs ``peerflix`` to download and play video

## The cache

A lot of things are put in the cache, which is located at ``$HOME/.show-time/cache``:

* The downloaded torrents
* OpenSubtitles results (.json)
* Subtitles (.srt)

You can remove files manually, or you can empty the whole cache with ``show-time --clear-cache``

## Roadmap

* Add configuration options
* Add support for chromecast
