'use strict'

const { fetch } = require('../utils')

// See https://yts.ag/api#list_movies

const trackers = [
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.openbittorrent.com:80',
  'udp://tracker.coppersurfer.tk:6969',
  'udp://glotorrents.pw:6969/announce',
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://torrent.gresille.org:80/announce',
  'udp://p4p.arenabg.com:1337',
  'udp://tracker.leechers-paradise.org:6969',
]

const searchUri = (query, page = 1) =>
  `https://yts.am/api/v2/list_movies.json?sort_by=seeds&order_by=desc&limit=20&page=${page}&query_term=${encodeURIComponent(query)}`

const magnet = movie => {
  const dn = encodeURIComponent(movie.title_long)
  const trs = trackers.map(tracker => encodeURIComponent(tracker)).join('&tr=')
  const uri = hash => `magnet:?xt=urn:btih:${hash}&dn=${dn}&tr=${trs}`
  if (movie.torrents.length === 1) {
    return uri(movie.torrents[0].hash)
  } else {
    return movie.torrents.map(({ hash, quality, size, date_uploaded }) => {
      const description = `${quality} (${size}) uploaded at ${date_uploaded}`
      return { description, url: uri(hash) }
    })
  }
}

module.exports = (query, page) =>
  fetch(searchUri(query, page))
  .then(JSON.parse)
  .then(res => {
    if (!res || res.status !== 'ok') {
      return Promise.reject(Error(res && res.status_message || 'No response or message'))
    }
    const { movie_count, limit, page_number, movies } = res.data
    if (movie_count === 0) {
      return { total: 0, more: false, data: [] }
    }
    const total = movie_count
    const more = limit * page_number < movie_count
    const data = movies.map(movie => ({
      title: movie.title,
      label: movie.torrents.length === 1 ? movie.title_long : `${movie.title_long} (${movie.torrents.length} torrents)`,
      url: magnet(movie)
    }))
    return { total, more, data }
  })

/*
https://yts.ag/api/v2/list_movies.json?sort_by=seeds&order_by=desc&limit=50&page=1&query_term=strange
{
  "status": "ok",
  "status_message": "Query was successful",
  "data": {
    "movie_count": 4,
    "limit": 50,
    "page_number": 1,
    "movies": [
      {
        "id": 6336,
        "url": "https://yts.ag/movie/doctor-strange-2016",
        "imdb_code": "tt1211837",
        "title": "Doctor Strange",
        "title_english": "Doctor Strange",
        "title_long": "Doctor Strange (2016)",
        "slug": "doctor-strange-2016",
        "year": 2016,
        "rating": 7.7,
        "runtime": 115,
        "genres": [
          "Action",
          "Adventure",
          "Fantasy",
          "Sci-Fi"
        ],
        "summary": "Marvel's \"Doctor Strange\" follows the story of the talented neurosurgeon Doctor Stephen Strange who, after a tragic car accident, must put ego aside and learn the secrets of a hidden world of mysticism and alternate dimensions. Based in New York City's Greenwich Village, Doctor Strange must act as an intermediary between the real world and what lies beyond, utilising a vast array of metaphysical abilities and artifacts to protect the Marvel Cinematic Universe.",
        "description_full": "Marvel's \"Doctor Strange\" follows the story of the talented neurosurgeon Doctor Stephen Strange who, after a tragic car accident, must put ego aside and learn the secrets of a hidden world of mysticism and alternate dimensions. Based in New York City's Greenwich Village, Doctor Strange must act as an intermediary between the real world and what lies beyond, utilising a vast array of metaphysical abilities and artifacts to protect the Marvel Cinematic Universe.",
        "synopsis": "Marvel's \"Doctor Strange\" follows the story of the talented neurosurgeon Doctor Stephen Strange who, after a tragic car accident, must put ego aside and learn the secrets of a hidden world of mysticism and alternate dimensions. Based in New York City's Greenwich Village, Doctor Strange must act as an intermediary between the real world and what lies beyond, utilising a vast array of metaphysical abilities and artifacts to protect the Marvel Cinematic Universe.",
        "yt_trailer_code": "HSzx-zryEgM",
        "language": "English",
        "mpa_rating": "PG-13",
        "background_image": "https://yts.ag/assets/images/movies/doctor_strange_2016/background.jpg",
        "background_image_original": "https://yts.ag/assets/images/movies/doctor_strange_2016/background.jpg",
        "small_cover_image": "https://yts.ag/assets/images/movies/doctor_strange_2016/small-cover.jpg",
        "medium_cover_image": "https://yts.ag/assets/images/movies/doctor_strange_2016/medium-cover.jpg",
        "large_cover_image": "https://yts.ag/assets/images/movies/doctor_strange_2016/large-cover.jpg",
        "state": "ok",
        "torrents": [
          {
            "url": "https://yts.ag/torrent/download/18566013BD5286AB1B155C809799820E043135AA",
            "hash": "18566013BD5286AB1B155C809799820E043135AA",
            "quality": "3D",
            "seeds": 208,
            "peers": 65,
            "size": "1.76 GB",
            "size_bytes": 1889785610,
            "date_uploaded": "2017-02-28 00:31:26",
            "date_uploaded_unix": 1488259886
          },
          {
            "url": "https://yts.ag/torrent/download/AFA238A8D953B6256D94FCF6D183917F5110E6F4",
            "hash": "AFA238A8D953B6256D94FCF6D183917F5110E6F4",
            "quality": "720p",
            "seeds": 2333,
            "peers": 548,
            "size": "844.93 MB",
            "size_bytes": 885973320,
            "date_uploaded": "2017-02-15 19:52:39",
            "date_uploaded_unix": 1487206359
          },
          {
            "url": "https://yts.ag/torrent/download/7BA0C6BD9B4E52EA2AD137D02394DE7D83B98091",
            "hash": "7BA0C6BD9B4E52EA2AD137D02394DE7D83B98091",
            "quality": "1080p",
            "seeds": 3290,
            "peers": 1051,
            "size": "1.75 GB",
            "size_bytes": 1879048192,
            "date_uploaded": "2017-02-15 22:01:48",
            "date_uploaded_unix": 1487214108
          }
        ],
        "date_uploaded": "2017-02-15 19:52:39",
        "date_uploaded_unix": 1487206359
      },
      …
    ]
  },
  "@meta": {
    "server_time": 1490489974,
    "server_timezone": "EST5EDT",
    "api_version": 2,
    "execution_time": "0.02 ms"
  }
}
*/
