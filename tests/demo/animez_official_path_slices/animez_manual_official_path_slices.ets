import hilog from '@ohos.hilog';
import http from '@ohos.net.http';
import rdb from '@ohos.data.relationalStore';
import fs from '@ohos.file.fs';
import router from '@ohos.router';
import media from '@ohos.multimedia.media';

const DOMAIN: number = 0xFF00;
const PREFIX: string = '[AnimeZ]';
const FORMAT: string = '%{public}s, %{public}s';

// Extracted from AnimeZ utils/Logger.ts:1-60.
class Logger {
  static e(tag: any, ...args: string[]) {
    hilog.error(DOMAIN, PREFIX, FORMAT, this.wrapArgs(tag, args));
  }

  static d(tag: any, ...args: string[]) {
    hilog.debug(DOMAIN, PREFIX, FORMAT, this.wrapArgs(tag, args));
  }

  static wrapArgs(tag: any, args: string[]): string[] {
    let name: string;
    if ((typeof tag) == 'string') {
      name = tag;
    } else if ((typeof tag) == 'function') {
      name = tag.name;
    } else if ((typeof tag) == 'object') {
      name = tag.constructor.name;
    } else {
      name = (typeof tag) + '-' + tag;
    }
    if (name) {
      if (args) {
        args.splice(0, 0, name);
      } else {
        args = [name];
      }
    }
    return args;
  }
}

type ValueType = number | string | boolean | Uint8Array;
type ValuesBucket = { [key: string]: ValueType | Uint8Array | null };

interface SearchHistoryInfo {
  id?: number;
  keyword: string;
  accessTime: number;
}

class VideoInfo {
  url: string;
  title: string;
  imgUrl: string;
  sourceKey: string;
}

class EpisodeInfo {
  title: string;
  link: string;
  videoUrl: string;
}

class EpisodeList {
  title: string;
  episodes: EpisodeInfo[] = [];
}

class VideoDetailInfo extends VideoInfo {
  coverUrl: string;
  desc: string;
  episodes: EpisodeList[] = [];
  recommends: VideoInfo[] = [];
}

class VideoHistoryInfo {
  link: string;
  title: string;
  totalTime: number;
  currentTime: number;
  coverUrl: string;
  episodeListIndex: number;
  episodeIndex: number;
  episodeName: string;
  videoUrl: string;
  videoProgress: number;
  sourceKey: string;
  accessTime: number;

  static createByLink(sourceKey: string, link: string): VideoHistoryInfo {
    const info = new VideoHistoryInfo();
    info.sourceKey = sourceKey;
    info.link = link;
    return info;
  }
}

class VideoCollectionInfo {
  src: string;
  title: string;
  coverUrl: string;
  sourceKey: string;
  accessTime: number;
}

// Extracted from AnimeZ db/AbsTable.ets:15-178.
abstract class AbsTable<T> {
  protected readonly tableName: string;
  private readonly dbName: string;
  protected readonly futureDb: Promise<rdb.RdbStore>;

  constructor(dbName: string, tableName: string) {
    this.dbName = dbName;
    this.tableName = tableName;
    this.futureDb = this.initDb();
  }

  private async initDb(): Promise<rdb.RdbStore> {
    Logger.e(this, 'initDb dbName=' + this.dbName + ' tableName=' + this.tableName);
    const db = await rdb.getRdbStore({}, {
      name: this.dbName,
      securityLevel: rdb.SecurityLevel.S1,
    });
    await db.executeSql(this.getCreateTableSql());
    return db;
  }

  getPredicates() {
    return new rdb.RdbPredicates(this.tableName);
  }

  abstract getColumnId(): string;
  abstract getTableColumns(): string[];
  abstract getCreateTableSql(): string;
  abstract createItem(cursor: rdb.ResultSet): T;
  abstract getEntityId(item: T): ValueType;

  bindToValuesBucket(bucket: ValuesBucket, item: T) {
    this.getTableColumns().forEach((col) => {
      bucket[col] = item[col];
    });
  }

  async insert(item: T): Promise<number> {
    const bucket = {};
    this.bindToValuesBucket(bucket, item);
    const db = await this.futureDb;
    return db.insert(this.tableName, bucket);
  }

  async update(item: T, predicates?: rdb.RdbPredicates): Promise<number> {
    const bucket = {};
    this.bindToValuesBucket(bucket, item);
    Logger.e(this, 'update bucket=' + JSON.stringify(bucket));
    bucket[this.getColumnId()] = undefined;
    const db = await this.futureDb;
    if (!predicates) {
      predicates = this.getPredicates().equalTo(this.getColumnId(), this.getEntityId(item));
    }
    return db.update(bucket, predicates);
  }

  async query(predicates: rdb.RdbPredicates, columns?: Array<string>): Promise<T[]> {
    Logger.e(this, 'queryAll');
    const db = await this.futureDb;
    const resultSet = await db.query(predicates, columns);
    const items: T[] = [];
    if (resultSet.goToFirstRow()) {
      do {
        Logger.e(this, 'queryAll rowIndex=' + resultSet.rowIndex);
        items.push(this.createItem(resultSet));
      } while (resultSet.goToNextRow());
    }
    Logger.e(this, 'queryAll items=' + JSON.stringify(items));
    return items;
  }

  async queryAll(predicates?: rdb.RdbPredicates): Promise<T[]> {
    if (!predicates) predicates = this.getPredicates();
    return this.query(predicates, this.getTableColumns());
  }
}

// Extracted from AnimeZ db/impl/SearchHistoryDao.ets:35-100.
class SearchHistoryTable extends AbsTable<SearchHistoryInfo> {
  constructor() {
    super('video_manager', 'search_history');
  }

  getColumnId(): string { return 'id'; }
  getTableColumns(): string[] { return ['id', 'keyword', 'accessTime']; }
  getCreateTableSql(): string {
    return 'CREATE TABLE IF NOT EXISTS search_history(id INTEGER PRIMARY KEY AUTOINCREMENT, keyword TEXT, accessTime INTEGER)';
  }
  getEntityId(item: SearchHistoryInfo): ValueType { return item.id; }
  createItem(cursor: rdb.ResultSet): SearchHistoryInfo {
    return {
      id: cursor.getLong(cursor.getColumnIndex('id')),
      keyword: cursor.getString(cursor.getColumnIndex('keyword')),
      accessTime: cursor.getLong(cursor.getColumnIndex('accessTime')),
    };
  }
  async saveOrUpdate(keyword: string): Promise<number> {
    Logger.e(this, 'saveOrUpdate keyword=' + keyword);
    const results = await this.query(this.getPredicates().equalTo('keyword', keyword));
    Logger.e(this, 'saveOrUpdate results=' + JSON.stringify(results));
    if (!results || results.length == 0) {
      return this.insert({ keyword: keyword, accessTime: new Date().getTime() });
    }
    const info = results[0];
    Logger.e(this, 'saveOrUpdate info=' + JSON.stringify(info));
    return this.update({
      id: info.id,
      keyword: keyword,
      accessTime: new Date().getTime(),
    }, this.getPredicates().equalTo('keyword', keyword));
  }
}

// Extracted from AnimeZ db/impl/VideoHistoryDao.ets:13-85.
class VideoHistoryTable extends AbsTable<VideoHistoryInfo> {
  constructor() {
    super('video_manager', 'video_history');
  }

  getColumnId(): string { return 'link'; }
  getTableColumns(): string[] {
    return ['link', 'title', 'totalTime', 'currentTime', 'coverUrl', 'episodeListIndex',
      'episodeIndex', 'episodeName', 'videoUrl', 'videoProgress', 'sourceKey', 'accessTime'];
  }
  getCreateTableSql(): string { return 'CREATE TABLE IF NOT EXISTS video_history(link TEXT PRIMARY KEY, title TEXT)'; }
  getEntityId(item: VideoHistoryInfo): ValueType { return item.link; }
  createItem(cursor: rdb.ResultSet): VideoHistoryInfo {
    const info = new VideoHistoryInfo();
    info.link = cursor.getString(cursor.getColumnIndex('link'));
    info.title = cursor.getString(cursor.getColumnIndex('title'));
    info.coverUrl = cursor.getString(cursor.getColumnIndex('coverUrl'));
    info.videoUrl = cursor.getString(cursor.getColumnIndex('videoUrl'));
    info.sourceKey = cursor.getString(cursor.getColumnIndex('sourceKey'));
    return info;
  }
  async queryByLink(link: string): Promise<VideoHistoryInfo> {
    const items = await this.query(this.getPredicates().equalTo('link', link));
    return items[0];
  }
  async save(item: VideoHistoryInfo): Promise<number> {
    Logger.e(this, 'save item=' + JSON.stringify(item));
    const info = await this.queryByLink(item.link);
    Logger.e(this, 'save info=' + JSON.stringify(info));
    if (info) return this.update(item);
    return this.insert(item);
  }
}

// Extracted from AnimeZ db/impl/VideoCollectionDao.ets:13-61.
class VideoCollectionTable extends AbsTable<VideoCollectionInfo> {
  constructor() {
    super('video_manager', 'video_collection');
  }

  getColumnId(): string { return 'src'; }
  getTableColumns(): string[] { return ['src', 'title', 'coverUrl', 'sourceKey', 'accessTime']; }
  getCreateTableSql(): string { return 'CREATE TABLE IF NOT EXISTS video_collection(src TEXT PRIMARY KEY, title TEXT)'; }
  getEntityId(item: VideoCollectionInfo): ValueType { return item.src; }
  createItem(cursor: rdb.ResultSet): VideoCollectionInfo {
    const info = new VideoCollectionInfo();
    info.src = cursor.getString(cursor.getColumnIndex('src'));
    info.title = cursor.getString(cursor.getColumnIndex('title'));
    info.coverUrl = cursor.getString(cursor.getColumnIndex('coverUrl'));
    info.sourceKey = cursor.getString(cursor.getColumnIndex('sourceKey'));
    return info;
  }
  async queryBySrc(src: string): Promise<VideoCollectionInfo> {
    const items = await this.query(this.getPredicates().equalTo('src', src));
    return items[0];
  }
  async save(item: VideoCollectionInfo): Promise<number> {
    Logger.e(this, 'save item=' + JSON.stringify(item));
    const info = await this.queryBySrc(item.src);
    Logger.e(this, 'save info=' + JSON.stringify(info));
    if (info) return this.update(item);
    return this.insert(item);
  }
}

// Extracted from AnimeZ utils/HttpUtils.ts:17-50.
class HttpUtils {
  static async getString(url: string, headers?: object): Promise<string> {
    Logger.e(this, 'getString createHttp');
    const httpRequest = http.createHttp();
    const header = headers ? headers : { 'User-Agent': 'AnimeZ-slice' };
    Logger.e(this, 'getString header=' + JSON.stringify(header));
    const resp: http.HttpResponse = await httpRequest.request(url, {
      method: http.RequestMethod.GET,
      readTimeout: 20000,
      connectTimeout: 20000,
      header: header,
    });
    Logger.e(this, 'getString resp=' + JSON.stringify(resp));
    return resp.result as string;
  }

  static async getHtml(url: string, headers?: object): Promise<string> {
    return this.getString(url, headers);
  }
}

function videoFromHtml(html: string): VideoInfo {
  const item = new VideoInfo();
  item.url = html + '/detail';
  item.title = html + '/title';
  item.imgUrl = html + '/img';
  item.sourceKey = 'key_yinghuavideo';
  return item;
}

function detailFromHtml(html: string): VideoDetailInfo {
  const episode = new EpisodeInfo();
  episode.title = html + '/ep';
  episode.link = html + '/play';
  episode.videoUrl = html + '/video.m3u8';
  const list = new EpisodeList();
  list.title = html + '/list';
  list.episodes = [episode];
  const info = new VideoDetailInfo();
  info.url = html + '/detail';
  info.title = html + '/title';
  info.imgUrl = html + '/img';
  info.coverUrl = html + '/cover';
  info.sourceKey = 'key_yinghuavideo';
  info.episodes = [list];
  info.recommends = [videoFromHtml(html)];
  return info;
}

// Extracted from AnimeZ api/impl/YingHuaDataSource.ts and BimiAcgDataSource.ts.
class YingHuaDataSource {
  async search(keyword: string, page: number): Promise<VideoInfo[]> {
    const url = 'https://www.yinghuacd.com/search/' + encodeURIComponent(keyword) + '?page=' + page;
    const html = await HttpUtils.getString(url);
    return [videoFromHtml(html)];
  }

  async getHomepageData(): Promise<{ bannerList: VideoInfo[]; categoryList: Array<{ title: string; videoList: VideoInfo[] }> }> {
    const html = await HttpUtils.getString('https://www.yinghuacd.com');
    Logger.e(this, 'parseHtml drama=' + html);
    const item = videoFromHtml(html);
    return { bannerList: [item], categoryList: [{ title: item.title, videoList: [item] }] };
  }

  async getVideoDetailInfo(url: string): Promise<VideoDetailInfo> {
    Logger.e(this, 'getVideoDetailInfo 1');
    const html = await HttpUtils.getHtml(url);
    const info = detailFromHtml(html);
    Logger.e(this, 'getVideoDetailInfo title=' + info.title);
    Logger.e(this, 'getEpisodes info=' + JSON.stringify(info.episodes[0].episodes[0]));
    return info;
  }

  async parseVideoUrl(link: string): Promise<string> {
    Logger.e(this, 'parseVideoUrl link=' + link);
    const html = await HttpUtils.getString(link);
    const url = html + '/parsed.m3u8';
    Logger.e(this, 'parseVideoUrl url=' + url);
    return url;
  }
}

class BimiAcgDataSource {
  async search(keyword: string, page: number): Promise<VideoInfo[]> {
    const url = 'http://www.bimiacg4.net/vod/search/wd/' + encodeURIComponent(keyword) + '/page/' + page;
    const html = await HttpUtils.getHtml(url);
    return [videoFromHtml(html)];
  }
}

class DataSourceManager {
  private static currentSourceKey: string = 'key_yinghuavideo';

  static setCurrentSource(key: string) {
    this.currentSourceKey = key;
  }

  static getCurrentSource(): YingHuaDataSource | BimiAcgDataSource {
    return this.getSource(this.currentSourceKey);
  }

  static getSource(key: string): YingHuaDataSource | BimiAcgDataSource {
    if (key === 'key_bimi_acg') return new BimiAcgDataSource();
    return new YingHuaDataSource();
  }
}

// Extracted from AnimeZ pages/SearchPage.ets:31-226.
class SearchPageSlice {
  keyword: string = '';
  videoList: VideoInfo[] = [];
  searchHistoryList: SearchHistoryInfo[] = [];

  aboutToAppear() {
    new SearchHistoryTable().queryAll().then((list) => {
      this.searchHistoryList = list;
      const item = this.searchHistoryList[0];
      this.doSearch(item.keyword);
    });
  }

  buildSearchInput() {
    TextInput({ text: this.keyword })
      .onChange((value: string) => {
        this.keyword = value;
      })
      .onSubmit(() => {
        this.doSearch(this.keyword);
      });
  }

  doSearch(keyword: string) {
    Logger.e(this, 'doSearch keyword=' + keyword);
    this.keyword = keyword;
    new SearchHistoryTable().saveOrUpdate(keyword);
    DataSourceManager.getCurrentSource().search(keyword, 1).then((videoList) => {
      this.videoList = videoList;
    });
  }
}

// Extracted from AnimeZ components/VideoList.ets:38-82.
class VideoListSlice {
  VideoItem(item: VideoInfo) {
    Image(item.imgUrl);
    router.pushUrl({
      url: 'pages/VideoDetailPage',
      params: {
        url: item.url,
        sourceKey: item.sourceKey,
        title: item.title,
        cover: item.imgUrl,
      },
    });
  }
}

// Extracted from AnimeZ components/home/Recommend.ets:159-177.
class RecommendSlice {
  bannerList: VideoInfo[] = [];
  categoryList: Array<{ title: string; videoList: VideoInfo[] }> = [];

  loadNextPage() {
    DataSourceManager.getCurrentSource().getHomepageData().then((data) => {
      Logger.e(this, 'loadNextPage list=' + JSON.stringify(data));
      this.bannerList = data.bannerList;
      this.categoryList = data.categoryList;
      Logger.e(this, 'categoryList=' + JSON.stringify(data.categoryList));
    });
  }
}

// Extracted from AnimeZ pages/VideoDetailPage.ets:109-145, 731-821.
class VideoDetailPageSlice {
  videoDetailInfo: VideoDetailInfo = null;
  historyInfo: VideoHistoryInfo = null;
  collectionInfo: VideoCollectionInfo = null;
  episodeListIndex: number = 0;
  episodeIndex: number = 0;
  url: string;
  sourceKey: string;
  playerManager: PlayerManagerImpl = new PlayerManagerImpl();

  aboutToAppear() {
    this.url = router.getParams()['url'];
    this.sourceKey = router.getParams()['sourceKey'];
    Logger.e(this, 'aboutToAppear url=' + this.url + ' sourceKey=' + this.sourceKey + ' params=' + JSON.stringify(router.getParams()));
    this.historyInfo = VideoHistoryInfo.createByLink(this.sourceKey, this.url);
    this.getDetailInfo();
  }

  getDetailInfo() {
    DataSourceManager.getSource(this.sourceKey).getVideoDetailInfo(this.url).then((info) => {
      Logger.e(this, 'videoDetailInfo=' + JSON.stringify(info));
      this.videoDetailInfo = info;
      this.historyInfo.title = this.videoDetailInfo.title;
      this.historyInfo.coverUrl = this.videoDetailInfo.coverUrl;
      this.historyInfo.sourceKey = this.sourceKey;
      this.playVideo(this.episodeListIndex, this.episodeIndex);
    });
  }

  playVideo(episodeListIndex: number, episodeIndex: number) {
    Logger.e(this, 'playVideo episodeListIndex=' + episodeListIndex + ' episodeIndex=' + episodeIndex);
    const episodeList = this.videoDetailInfo.episodes[episodeListIndex];
    const episode = episodeList.episodes[episodeIndex];
    Logger.e(this, 'playVideo episode=' + JSON.stringify(episode));
    this.historyInfo.episodeListIndex = episodeListIndex;
    this.historyInfo.episodeIndex = episodeIndex;
    this.historyInfo.episodeName = episode.title;
    this.historyInfo.videoUrl = episode.videoUrl;
    Logger.e(this, 'playVideo historyInfo=' + JSON.stringify(this.historyInfo));
    this.saveHistoryInfo();
    this.playerManager.playEpisodeList(episodeList.episodes, episodeIndex);
    DataSourceManager.getSource(this.videoDetailInfo.sourceKey).parseVideoUrl(episode.link).then((url) => {
      episode.videoUrl = url;
      this.historyInfo.videoUrl = episode.videoUrl;
      this.saveHistoryInfo();
      this.playerManager.playEpisodeList(episodeList.episodes, episodeIndex);
    });
  }

  saveHistoryInfo() {
    this.historyInfo.accessTime = new Date().getTime();
    new VideoHistoryTable().save(this.historyInfo);
  }

  collect() {
    const collectionInfo = new VideoCollectionInfo();
    collectionInfo.src = this.url;
    collectionInfo.title = this.videoDetailInfo.title;
    collectionInfo.coverUrl = this.videoDetailInfo.coverUrl;
    collectionInfo.accessTime = new Date().getTime();
    collectionInfo.sourceKey = this.sourceKey;
    new VideoCollectionTable().insert(collectionInfo);
    this.collectionInfo = collectionInfo;
  }
}

interface IPlayer {
  setDataSource(url: string): Promise<void>;
}

// Extracted from AnimeZ player/PlayerManagerImpl.ets:47-106.
class PlayerManagerImpl {
  private url: string;
  private episodeList: EpisodeInfo[] = [];
  private episodeIndex: number = 0;
  private player: IPlayer;

  init(player: IPlayer) {
    this.player = player;
    Logger.e(this, 'init url=' + this.url);
    if (this.url) this.player.setDataSource(this.url);
  }

  async playEpisodeList(episodeList: EpisodeInfo[], episodeIndex: number = 0): Promise<void> {
    Logger.e(this, 'playEpisodeList index=' + episodeIndex + ' episodeList=' + JSON.stringify(episodeList));
    this.episodeList = episodeList;
    this.episodeIndex = episodeIndex;
    const episode = this.episodeList[this.episodeIndex];
    if (episode.videoUrl) await this.setPlayerUrl(episode.videoUrl);
  }

  async setPlayerUrl(url: string) {
    Logger.e(this, 'setPlayerUrl url=' + url);
    this.url = url;
    if (this.player) await this.player.setDataSource(url);
  }
}

// Extracted from AnimeZ player/AVideoPlayer.ets:15-36.
class AVPlayerWrapper implements IPlayer {
  private readonly avPlayer: media.AVPlayer;

  constructor(avPlayer: media.AVPlayer) {
    this.avPlayer = avPlayer;
  }

  async setDataSource(url: string): Promise<void> {
    Logger.e(this, 'setDataSource url=' + url);
    this.avPlayer.url = url;
  }
}

class TaskInfo {
  taskId: number;
  parentTaskId: number;
  taskName: string;
  createTime: number;
  totalWorkload: number = 0;
  completeWorkload: number = 0;
  prepared: boolean = false;
  constructor(taskId: number, parentTaskId: number, createTime: number = new Date().getTime()) {
    this.taskId = taskId;
    this.parentTaskId = parentTaskId;
    this.createTime = createTime;
  }
}

// Extracted from AnimeZ download/DownloadTaskInfo.ets.
class DownloadTaskInfo extends TaskInfo {
  fileName: string;
  downloadDir: string;
  originalUrl: string;
  url: string;
  blockDownload: boolean = false;
}

// Extracted from AnimeZ download/FileDownloadDao.ets.
class FileDownloadTable extends AbsTable<DownloadTaskInfo> {
  constructor() {
    super('download_manager', 'download_tasks');
  }

  getColumnId(): string { return 'taskId'; }
  getTableColumns(): string[] {
    return ['taskId', 'parentTaskId', 'taskName', 'createTime', 'fileName', 'originalUrl', 'url', 'downloadDir'];
  }
  getCreateTableSql(): string { return 'CREATE TABLE IF NOT EXISTS download_tasks(taskId INTEGER PRIMARY KEY, url TEXT)'; }
  getEntityId(item: DownloadTaskInfo): ValueType { return item.taskId; }
  createItem(cursor: rdb.ResultSet): DownloadTaskInfo {
    const info = new DownloadTaskInfo(cursor.getLong(cursor.getColumnIndex('taskId')), cursor.getLong(cursor.getColumnIndex('parentTaskId')));
    info.originalUrl = cursor.getString(cursor.getColumnIndex('originalUrl'));
    info.url = cursor.getString(cursor.getColumnIndex('url'));
    return info;
  }
  async queryById(taskId: number): Promise<DownloadTaskInfo> {
    const items = await this.query(this.getPredicates().equalTo('taskId', taskId));
    return items[0];
  }
  async save(item: DownloadTaskInfo): Promise<number> {
    Logger.e(this, 'save item=' + JSON.stringify(item));
    const info = await this.queryById(item.taskId);
    Logger.e(this, 'save info=' + JSON.stringify(info));
    if (info) return this.update(item);
    return this.insert(item);
  }
}

// Extracted from AnimeZ download/DownloadTaskInfoRepository.ets:17-26.
class DownloadTaskInfoRepository {
  async create(taskInfo: DownloadTaskInfo): Promise<number> {
    Logger.e(this, 'create taskId=' + taskInfo.taskId);
    return new FileDownloadTable().save(taskInfo);
  }

  async update(taskInfo: DownloadTaskInfo): Promise<number> {
    Logger.e(this, 'update taskInfo=' + JSON.stringify(taskInfo));
    return new FileDownloadTable().update(taskInfo);
  }
}

// Extracted from AnimeZ download/core/TaskManager.ets:221-332.
class TaskManager {
  readonly tasks: FileDownloadTask[] = [];
  taskInfoRepository: DownloadTaskInfoRepository = new DownloadTaskInfoRepository();
  private nextTaskId: number = 1;

  generateTaskId(): number { return this.nextTaskId++; }
  getParentTaskId(): number { return 0; }
  addTask(task: FileDownloadTask) { this.tasks.push(task); }
  start(task: FileDownloadTask) {
    this.taskInfoRepository.create(task.taskInfo);
    this.process(task);
  }
  startAll() {
    this.tasks.forEach((task) => this.start(task));
  }
  process(task: FileDownloadTask) {
    task.download();
  }
}

// Extracted from AnimeZ download/FileDownloadTask.ets:53-198.
class FileDownloadTask {
  readonly manager: TaskManager;
  readonly taskInfo: DownloadTaskInfo;
  constructor(manager: TaskManager, taskInfo: DownloadTaskInfo) {
    this.manager = manager;
    this.taskInfo = taskInfo;
  }
  getFilePath(): string { return this.taskInfo.downloadDir + '/' + this.taskInfo.fileName; }
  async download(): Promise<boolean> {
    Logger.e(this, 'download');
    const httpRequest = http.createHttp();
    Logger.e(this, 'download httpRequest');
    const resp = await httpRequest.request(this.taskInfo.url, {
      method: http.RequestMethod.GET,
      readTimeout: 20000,
      connectTimeout: 20000,
      expectDataType: http.HttpDataType.ARRAY_BUFFER,
    });
    Logger.e(this, 'download resp=' + JSON.stringify(resp));
    return this.save(resp.result as ArrayBuffer);
  }
  async save(buffer: ArrayBuffer): Promise<boolean> {
    const file = await fs.open(this.getFilePath(), fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY);
    return this.saveSlice(file.fd, buffer);
  }
  async saveSlice(fd: number, buffer: ArrayBuffer): Promise<boolean> {
    Logger.d(this, 'saveSlice byteLength=' + buffer.byteLength);
    const result = await fs.write(fd, buffer, { encoding: 'utf-8' });
    Logger.e(this, 'saveSlice result=' + result);
    return true;
  }
}

class M3u8Segment {
  url: string;
  name: string;
  duration: number;
  hasKey: boolean;
  keyUrl: string;
  keyName: string;
}

class M3u8 {
  url: string;
  duration: number;
  version: number;
  sequence: number;
  readonly segmentList: M3u8Segment[] = [];
}

// Extracted from AnimeZ player/m3u8/M3U8Utils.ts:55-306.
class M3U8Utils {
  static async parse(parentUrl: string, videoUrl: string, content?: string): Promise<M3u8> {
    Logger.e(this, 'parse parentUrl=' + parentUrl + ' videoUrl=' + videoUrl);
    if (!content) content = await HttpUtils.getString(videoUrl);
    Logger.e(this, 'parse content=' + content);
    const seg = new M3u8Segment();
    seg.url = content + '/seg.ts';
    seg.name = 'seg.ts';
    seg.duration = 1;
    seg.hasKey = true;
    seg.keyUrl = content + '/key';
    seg.keyName = 'seg.key';
    Logger.e(this, 'seg tempUrl=' + seg.url);
    const m3u8 = new M3u8();
    m3u8.url = videoUrl;
    m3u8.duration = 1;
    m3u8.version = 3;
    m3u8.sequence = 0;
    m3u8.segmentList.push(seg);
    return m3u8;
  }

  static async saveM3U8OriginInfo(m3u8: M3u8, path: string): Promise<number> {
    let content = '#EXTM3U\\n';
    for (const seg of m3u8.segmentList) {
      content += seg.url + '\\n';
    }
    Logger.e(this, 'saveM3U8OriginInfo content=' + content);
    const file = await fs.open(path, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY);
    return fs.write(file.fd, content, { encoding: 'utf-8' });
  }

  static async saveM3U8LocalInfo(m3u8: M3u8, path: string): Promise<number> {
    let content = '#EXTM3U\\n';
    for (const seg of m3u8.segmentList) {
      content += seg.name + '\\n';
    }
    Logger.e(this, 'saveM3U8OriginInfo content=' + content);
    const file = await fs.open(path, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY);
    return fs.write(file.fd, content, { encoding: 'utf-8' });
  }
}

class M3U8VideoInfo {
  sourceKey: string;
  pageLink: string;
  coverUrl: string;
  m3u8: M3u8 = null;
}

// Extracted from AnimeZ download/Downloader.ets and player/m3u8/M3U8Downloader.ets.
class M3U8Downloader extends TaskManager {
  with(url: string): M3U8DownloadTaskBuilder {
    return new M3U8DownloadTaskBuilder(this, url);
  }
  buildTask(builder: M3U8DownloadTaskBuilder): M3U8DownloadTask {
    const taskInfo = new DownloadTaskInfo(this.generateTaskId(), this.getParentTaskId());
    taskInfo.taskName = builder.taskName;
    taskInfo.originalUrl = builder.url;
    taskInfo.url = builder.url;
    taskInfo.fileName = builder.fileName;
    taskInfo.downloadDir = builder.downloadDir;
    const task = new M3U8DownloadTask(this, taskInfo);
    task.videoInfo.pageLink = builder.pageLink;
    task.videoInfo.coverUrl = builder.coverUrl;
    task.videoInfo.sourceKey = builder.sourceKey;
    this.addTask(task);
    return task;
  }
}

class M3U8DownloadTaskBuilder {
  readonly taskManager: M3U8Downloader;
  url: string;
  taskName: string;
  fileName: string;
  downloadDir: string;
  pageLink: string;
  coverUrl: string;
  sourceKey: string;
  constructor(taskManager: M3U8Downloader, url: string) {
    this.taskManager = taskManager;
    this.url = url;
  }
  setTaskName(name: string): M3U8DownloadTaskBuilder { this.taskName = name; return this; }
  setFileName(name: string): M3U8DownloadTaskBuilder { this.fileName = name; return this; }
  setDownloadDir(dir: string): M3U8DownloadTaskBuilder { this.downloadDir = dir; return this; }
  setPageLink(pageLink: string): M3U8DownloadTaskBuilder { this.pageLink = pageLink; return this; }
  setCoverUrl(coverUrl: string): M3U8DownloadTaskBuilder { this.coverUrl = coverUrl; return this; }
  setSourceKey(sourceKey: string): M3U8DownloadTaskBuilder { this.sourceKey = sourceKey; return this; }
  build(): M3U8DownloadTask { return this.taskManager.buildTask(this); }
}

// Extracted from AnimeZ player/m3u8/M3U8Downloader.ets:87-239.
class M3U8DownloadTask extends FileDownloadTask {
  readonly childTaskManager: TaskManager = new TaskManager();
  readonly videoInfo: M3U8VideoInfo = new M3U8VideoInfo();
  private readonly taskDir: string;
  constructor(manager: TaskManager, taskInfo: DownloadTaskInfo) {
    super(manager, taskInfo);
    this.taskDir = this.taskInfo.downloadDir + '/animez/';
  }

  async doRestore(): Promise<void> {
    const infoPath = this.taskDir + 'video.info';
    const text = await fs.readText(infoPath, { encoding: 'utf-8' });
    Logger.e(this, 'doRestore text=' + text);
    const info = JSON.parse(text);
    this.videoInfo.pageLink = info.pageLink;
    this.videoInfo.coverUrl = info.coverUrl;
    this.videoInfo.m3u8 = info.m3u8;
    Logger.e(this, 'doRestore videoInfo=' + JSON.stringify(this.videoInfo));
  }

  doInit() {
    Logger.e(this, 'doInit taskInfo=' + JSON.stringify(this.taskInfo));
    this.initTask();
  }

  private async saveVideoInfo(): Promise<number> {
    const file = await fs.open(this.taskDir + 'video.info', fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY);
    return fs.write(file.fd, JSON.stringify(this.videoInfo), { encoding: 'utf-8' });
  }

  private async initTask(): Promise<number> {
    let result = await this.saveVideoInfo();
    Logger.e(this, 'initTask saveVideoInfo result=' + result);
    this.taskInfo.url = await DataSourceManager.getSource(this.videoInfo.sourceKey).parseVideoUrl(this.taskInfo.originalUrl);
    Logger.e(this, 'initTask url=' + this.taskInfo.url);
    this.videoInfo.m3u8 = await M3U8Utils.parse(null, this.taskInfo.url);
    result = await this.saveVideoInfo();
    result = await M3U8Utils.saveM3U8LocalInfo(this.videoInfo.m3u8, this.taskDir + 'index.m3u8');
    result = await M3U8Utils.saveM3U8OriginInfo(this.videoInfo.m3u8, this.taskDir + 'index_origin.m3u8');
    return result;
  }

  doStart() {
    this.prepare().then(() => this.childTaskManager.startAll());
  }

  private async prepare() {
    if (!this.videoInfo.m3u8) {
      const text = await fs.readText(this.taskDir + 'video.info', { encoding: 'utf-8' });
      Logger.e(this, 'prepare text=' + text);
      this.videoInfo.m3u8 = JSON.parse(text).m3u8;
    }
    for (const seg of this.videoInfo.m3u8.segmentList) {
      const taskInfo = new DownloadTaskInfo(this.childTaskManager.generateTaskId(), this.childTaskManager.getParentTaskId());
      taskInfo.originalUrl = seg.url;
      taskInfo.url = seg.url;
      taskInfo.fileName = seg.name;
      taskInfo.taskName = seg.name;
      taskInfo.downloadDir = this.taskDir;
      Logger.e(this, 'init segment task : ' + JSON.stringify(taskInfo));
      this.childTaskManager.addTask(new FileDownloadTask(this.childTaskManager, taskInfo));
      if (seg.hasKey && seg.keyUrl) {
        const keyInfo = new DownloadTaskInfo(this.childTaskManager.generateTaskId(), this.childTaskManager.getParentTaskId());
        keyInfo.originalUrl = seg.keyUrl;
        keyInfo.url = seg.keyUrl;
        keyInfo.fileName = seg.keyName;
        keyInfo.taskName = seg.keyName;
        keyInfo.downloadDir = this.taskDir;
        this.childTaskManager.addTask(new FileDownloadTask(this.childTaskManager, keyInfo));
      }
    }
  }
}

// F01/F03: AnimeZ.md F01/F03, SearchPage.ets:95-115,213-229 -> Logger.ts:33-56 and YingHuaDataSource.ts:23-27 -> HttpUtils.ts:30-49.
export function animez_F01_F03_search_textinput_to_log_and_yinghua_http_T(): void {
  DataSourceManager.setCurrentSource('key_yinghuavideo');
  new SearchPageSlice().buildSearchInput();
}

// F02: AnimeZ.md F02, SearchPage.ets:213-226 -> SearchHistoryDao.ets:80-100 -> AbsTable.ets:95-149.
export function animez_F02_search_textinput_to_rdb_T(): void {
  new SearchPageSlice().buildSearchInput();
}

// F04: AnimeZ.md F04, SearchPage.ets:95-115,213-229 -> BimiAcgDataSource.ts:24-27 -> HttpUtils.ts:30-49.
export function animez_F04_search_textinput_to_bimi_http_T(): void {
  DataSourceManager.setCurrentSource('key_bimi_acg');
  new SearchPageSlice().buildSearchInput();
}

// F05/F06: SearchPage.ets:33-34, 175, 213-226 -> SearchHistoryDao.ets:62-68.
export function animez_F05_F06_rdb_history_to_log_and_http_T(): void {
  new SearchPageSlice().aboutToAppear();
}

// F07: AnimeZ.md F07, HttpUtils.ts:30-49.
export function animez_F07_http_response_to_hilog_T(): void {
  HttpUtils.getString('http://fixture/search?q=animez');
}

// F08/F09: Recommend.ets:159-177 -> DataSource getHomepageData / parseHtml logs.
export function animez_F08_F09_homepage_http_to_logs_T(): void {
  new RecommendSlice().loadNextPage();
}

// F10/F11/F12: DataSource remote VideoInfo -> VideoList router/Image -> VideoDetail router.getParams/log/http.
export function animez_F10_F11_F12_remote_video_to_router_image_detail_T(): void {
  DataSourceManager.getCurrentSource().getHomepageData().then((data) => {
    const item = data.bannerList[0];
    new VideoListSlice().VideoItem(item);
    new VideoDetailPageSlice().aboutToAppear();
  });
}

// F13-F15/F20/F21/F23: VideoDetail/DataSource/player logs.
export function animez_F13_F15_F20_F21_F23_detail_play_logs_T(): void {
  DataSourceManager.getSource('key_yinghuavideo').getVideoDetailInfo('http://fixture/detail').then((info) => {
    const page = new VideoDetailPageSlice();
    page.sourceKey = info.sourceKey;
    page.url = info.url;
    page.historyInfo = VideoHistoryInfo.createByLink(info.sourceKey, info.url);
    page.videoDetailInfo = info;
    page.playVideo(0, 0);
  });
}

// F16-F19: VideoDetailPage saveHistoryInfo/collect -> DAO/RDB/log.
export function animez_F16_F19_detail_objects_to_rdb_and_logs_T(): void {
  DataSourceManager.getSource('key_yinghuavideo').getVideoDetailInfo('http://fixture/detail').then((info) => {
    const page = new VideoDetailPageSlice();
    page.sourceKey = info.sourceKey;
    page.url = info.url;
    page.historyInfo = VideoHistoryInfo.createByLink(info.sourceKey, info.url);
    page.videoDetailInfo = info;
    page.playVideo(0, 0);
    page.collect();
  });
}

// F22: PlayerManagerImpl -> AVPlayerWrapper.avPlayer.url assignment.
export function animez_F22_episode_video_url_to_avplayer_url_T(): void {
  DataSourceManager.getSource('key_yinghuavideo').getVideoDetailInfo('http://fixture/detail').then((info) => {
    media.createAVPlayer().then((player) => {
      const manager = new PlayerManagerImpl();
      manager.init(new AVPlayerWrapper(player));
      manager.playEpisodeList(info.episodes[0].episodes, 0);
    });
  });
}

// F24-F26: Episode link -> M3U8Downloader.with/build/init -> fs/RDB/http.
export function animez_F24_F26_episode_link_to_m3u8_init_T(): void {
  DataSourceManager.getSource('key_yinghuavideo').getVideoDetailInfo('http://fixture/detail').then((info) => {
    const episode = info.episodes[0].episodes[0];
    const downloader = new M3U8Downloader();
    const task = downloader.with(episode.link)
      .setDownloadDir('/tmp/animez')
      .setFileName('index.m3u8')
      .setTaskName(episode.title)
      .setPageLink(episode.link)
      .setCoverUrl(info.coverUrl)
      .setSourceKey(info.sourceKey)
      .build();
    downloader.start(task);
    task.doInit();
  });
}

// F27-F29: M3U8Utils.parse HTTP text -> logs and fs.write.
export function animez_F27_F29_m3u8_http_text_to_logs_and_fs_T(): void {
  M3U8Utils.parse(null, 'http://fixture/index.m3u8').then((m3u8) => {
    M3U8Utils.saveM3U8LocalInfo(m3u8, '/tmp/animez/index.m3u8');
    M3U8Utils.saveM3U8OriginInfo(m3u8, '/tmp/animez/index_origin.m3u8');
  });
}

// F30-F33: parsed segment/key URLs -> child DownloadTaskInfo -> RDB/http.
export function animez_F30_F33_m3u8_segment_key_to_child_tasks_T(): void {
  M3U8Utils.parse(null, 'http://fixture/index.m3u8').then((m3u8) => {
    const downloader = new M3U8Downloader();
    const task = downloader.with('http://fixture/index.m3u8')
      .setDownloadDir('/tmp/animez')
      .setFileName('index.m3u8')
      .setTaskName('animez')
      .setPageLink('page')
      .setCoverUrl('cover')
      .setSourceKey('key_yinghuavideo')
      .build();
    task.videoInfo.m3u8 = m3u8;
    task.doStart();
  });
}

// F34-F36: FileDownloadTask.download HTTP response -> log/fs.write.
export function animez_F34_F36_download_http_response_to_fs_and_log_T(): void {
  const manager = new TaskManager();
  const info = new DownloadTaskInfo(1, 0);
  info.url = 'http://fixture/seg.ts';
  info.originalUrl = info.url;
  info.fileName = 'seg.ts';
  info.downloadDir = '/tmp/animez';
  const task = new FileDownloadTask(manager, info);
  manager.addTask(task);
  task.download();
}

// F37/F38: fs.readText(video.info) -> log/JSON.parse -> child task follow-up.
export function animez_F37_F38_video_info_read_to_log_and_followup_T(): void {
  const downloader = new M3U8Downloader();
  const task = downloader.with('http://fixture/index.m3u8')
    .setDownloadDir('/tmp/animez')
    .setFileName('index.m3u8')
    .setTaskName('animez')
    .setPageLink('page')
    .setCoverUrl('cover')
    .setSourceKey('key_yinghuavideo')
    .build();
  task.doRestore();
  task.doStart();
}

// F37 minimal slice from M3U8Downloader.ets:99-105.
export function animez_F37_video_info_read_to_hilog_min_T(): void {
  fs.readText('/tmp/animez/video.info', { encoding: 'utf-8' }).then((text) => {
    Logger.e(M3U8Downloader, 'doRestore text=' + text);
    const info = JSON.parse(text);
    Logger.e(M3U8Downloader, 'doRestore videoInfo=' + JSON.stringify(info));
  });
}

// F38 minimal slice from M3U8Downloader.ets:209-240 and FileDownloadTask.ets:147-156.
export function animez_F38_video_info_read_to_followup_http_min_T(): void {
  fs.readText('/tmp/animez/video.info', { encoding: 'utf-8' }).then((text) => {
    const videoInfo = JSON.parse(text);
    const seg = videoInfo.m3u8.segmentList[0];
    const httpRequest = http.createHttp();
    httpRequest.request(seg.url, {
      method: http.RequestMethod.GET,
      readTimeout: 20000,
      connectTimeout: 20000,
      expectDataType: http.HttpDataType.ARRAY_BUFFER,
    });
  });
}
