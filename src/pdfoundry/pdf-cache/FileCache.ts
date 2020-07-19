/* Copyright 2020 Andrew Cuccinello
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import Settings from '../settings/Settings';
import CacheHelper from './cache/CacheHelper';

/**
 * Meta information about a cache entry
 */
type CacheData = {
    /**
     * The size in bytes this cache entry takes up.
     */
    size: number;
    /**
     * The date the cache was last accessed, represented by a ISO string.
     */
    dateAccessed: string;
};

/**
 * Handles caching for PDFs
 */
export default class FileCache {
    // <editor-fold desc="Static Properties">
    /**
     * Max size of the cache for the active user, defaults to 256 MB.
     */
    public static get MAX_BYTES() {
        return game.settings.get(Settings.EXTERNAL_SYSTEM_NAME, 'CacheSize') * 2 ** 20;
    }

    private static readonly IDB_NAME: string = 'PDFoundry';
    private static readonly IDB_VERSION: number = 1;

    private static readonly CACHE: string = `Cache`;
    private static readonly META: string = `Meta`;

    private static _cacheHelper: CacheHelper;
    // </editor-fold>

    public static async initialize() {
        FileCache._cacheHelper = await CacheHelper.createAndOpen(FileCache.IDB_NAME, [FileCache.CACHE, FileCache.META], FileCache.IDB_VERSION);
    }

    /**
     * Get meta information about a provided key (url).
     * @param key
     */
    public static async getMeta(key: string): Promise<CacheData | null> {
        try {
            return await FileCache._cacheHelper.get(key, FileCache.META);
        } catch (error) {
            return null;
        }
    }

    /**
     * Set meta information about a provided key (url). See {@link CacheData}.
     * @param key
     * @param meta
     */
    public static async setMeta(key: string, meta: CacheData): Promise<void> {
        await FileCache._cacheHelper.set(key, meta, FileCache.META, true);
    }

    /**
     * Get the byte array representing the key (url) from the user's cache.
     * @param key
     */
    public static async getCache(key: string): Promise<Uint8Array | null> {
        try {
            const bytes = await FileCache._cacheHelper.get(key, FileCache.CACHE);
            const meta: CacheData = {
                dateAccessed: new Date().toISOString(),
                size: bytes.length,
            };
            await FileCache.setMeta(key, meta);

            return bytes;
        } catch (error) {
            return null;
        }
    }

    /**
     * Set the value of the cache for the specific key (url) to the provided byte array.
     * @param key
     * @param bytes
     */
    public static async setCache(key: string, bytes: Uint8Array) {
        const meta: CacheData = {
            dateAccessed: new Date().toISOString(),
            size: bytes.length,
        };

        await FileCache._cacheHelper.set(key, bytes, FileCache.CACHE, true);
        await FileCache.setMeta(key, meta);
        await this.prune();
    }

    /**
     * Preload the PDF at the specified key (url), caching it immediately.
     * @param key
     */
    public static preload(key: string): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            const cachedBytes = await FileCache.getCache(key);
            if (cachedBytes !== null && cachedBytes.byteLength > 0) {
                resolve();
                return;
            }

            const response = await fetch(key);
            if (response.ok) {
                const fetchedBytes = new Uint8Array(await response.arrayBuffer());
                if (fetchedBytes.byteLength > 0) {
                    await FileCache.setCache(key, fetchedBytes);
                    resolve();
                    return;
                } else {
                    reject('Fetch failed.');
                }
            } else {
                reject('Fetch failed.');
            }
        });
    }

    /**
     * Prune the active user's cache until it is below the user's cache size limit.
     */
    public static async prune() {
        const keys = await this._cacheHelper.keys(FileCache.META);

        let totalBytes = 0;
        let metas: any[] = [];
        for (const key of keys) {
            const meta = await this._cacheHelper.get(key, FileCache.META);
            meta.dateAccessed = Date.parse(meta.dateAccessed);
            meta.size = parseInt(meta.size);

            totalBytes += meta.size;

            metas.push({
                key,
                meta,
            });
        }

        metas = metas.sort((a, b) => {
            return a.meta.dateAccessed - b.meta.dateAccessed;
        });

        for (let i = 0; i < metas.length; i++) {
            if (totalBytes < FileCache.MAX_BYTES) {
                break;
            }

            const next = metas[i];

            await this._cacheHelper.del(next.key, FileCache.META);
            await this._cacheHelper.del(next.key, FileCache.CACHE);

            totalBytes -= next.meta.size;
        }
    }
}
