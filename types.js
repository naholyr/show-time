//@flow

export type Options = {
  cache: string,
  player: ?string,
  feed: string,
  lang: string,
  port: number,
  'peer-port': number,
  log: (...params: any[]) => void,
  offline: boolean,
  browse: boolean,
  movie: boolean,
  title: ?string,
}

export type NamedStat = {
  name: string,
  size: number,
  isDirectory: () => boolean,
  mtime: Date,
}

export type DirStat = {
  files: NamedStat[],
  count: number,
  size: number,
  hsize: string,
}

export type OrigSubtitles = {
  SubLanguageID: string,
  SubAddDate: string,
  SubFileName: string,
  SubSize: number,
  SubDownloadLink: string,
  MovieReleaseName: string,
}

export type Show = {
  url: string,
  title: string,
  subtitles: ?string,
}

export type DateUnit = 'year'|'month'|'week'|'day'|'hour'|'minute'|'second'|'millisecond'
