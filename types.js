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
}

export type NamedStat = {
  name: string,
  isDirectory: () => boolean,
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
}

export type Show = {
  url: string | { description: string, url: string }[],
  title: string,
  subtitles: ?string,
}
