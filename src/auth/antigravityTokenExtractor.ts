/**
 * Antigravity 本地 Token 提取器
 * 从 Antigravity IDE 的本地数据库中提取已存储的 refresh_token
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import initSqlJs, { SqlJsStatic } from 'sql.js';
import { logger } from '../logger';

// 缓存 sql.js 初始化，避免重复加载 wasm
let sqlInitPromise: Promise<SqlJsStatic> | null = null;

/**
 * 获取所有可能的 Antigravity 数据库候选路径（兼容 Antigravity 1.x 与 2.x "Antigravity IDE"）
 */
function getAntigravityDbCandidates(): string[] {
    const platform = os.platform();
    const home = os.homedir();
    const candidates: string[] = [];

    if (platform === 'darwin') {
        candidates.push(
            path.join(home, 'Library/Application Support/Antigravity IDE/User/globalStorage/state.vscdb'),
            path.join(home, 'Library/Application Support/Antigravity/User/globalStorage/state.vscdb'),
            path.join(home, 'Library/Application Support/com.google.antigravity-ide/User/globalStorage/state.vscdb')
        );
    } else if (platform === 'win32') {
        const appData = process.env.APPDATA || '';
        candidates.push(
            path.join(appData, 'Antigravity IDE/User/globalStorage/state.vscdb'),
            path.join(appData, 'Antigravity/User/globalStorage/state.vscdb'),
            path.join(appData, 'antigravity-ide/User/globalStorage/state.vscdb')
        );
    } else {
        candidates.push(
            path.join(home, '.config/Antigravity IDE/User/globalStorage/state.vscdb'),
            path.join(home, '.config/antigravity-ide/User/globalStorage/state.vscdb'),
            path.join(home, '.config/Antigravity/User/globalStorage/state.vscdb'),
            path.join(home, '.antigravity-ide-server/data/User/globalStorage/state.vscdb'),
            path.join(home, '.antigravity-server/data/User/globalStorage/state.vscdb')
        );
    }

    return candidates;
}

/**
 * 检查 Antigravity 数据库是否存在
 */
export function hasAntigravityDb(): boolean {
    const candidates = getAntigravityDbCandidates();
    return candidates.some(p => fs.existsSync(p));
}

/**
 * 从 Antigravity 数据库提取 refresh_token
 * @returns refresh_token 或 null（如果提取失败）
 */
export async function extractRefreshTokenFromAntigravity(): Promise<string | null> {
    const candidates = getAntigravityDbCandidates().filter(p => fs.existsSync(p));

    if (candidates.length === 0) {
        logger.debug('TokenExtractor', 'No existing Antigravity database found among candidates');
        return null;
    }

    const SQL = await getSqlInstance();

    for (const dbPath of candidates) {
        try {
            logger.debug('TokenExtractor', 'Attempting to extract token from:', dbPath);
            const dbBuffer = await fs.promises.readFile(dbPath);
            const db = new SQL.Database(dbBuffer);

            // 优先查找 jetskiStateSync.agentManagerInitState
            let base64Data = '';
            const stmt = db.prepare("SELECT value FROM ItemTable WHERE key = $key");
            stmt.bind({ $key: 'jetskiStateSync.agentManagerInitState' });

            if (stmt.step()) {
                const row = stmt.getAsObject();
                base64Data = typeof row.value === 'string' ? row.value.trim() : '';
            }
            stmt.free();

            // 若未找到，模糊查找包含 agentManagerInitState、jetskiStateSync 或 oauth 的 key
            if (!base64Data) {
                const fallbackStmt = db.prepare(
                    "SELECT value FROM ItemTable WHERE key LIKE '%agentManagerInitState%' OR key LIKE '%jetskiStateSync%' OR key LIKE '%OAuth%'"
                );
                while (fallbackStmt.step()) {
                    const row = fallbackStmt.getAsObject();
                    const val = typeof row.value === 'string' ? row.value.trim() : '';
                    if (val) {
                        try {
                            const buf = Buffer.from(val, 'base64');
                            const token = parseProtobufForRefreshToken(buf);
                            if (token) {
                                base64Data = val;
                                break;
                            }
                        } catch {
                            // continue checking
                        }
                    }
                }
                fallbackStmt.free();
            }

            db.close();

            if (!base64Data) {
                console.log(`[AntigravityTokenExtractor] Login state empty in ${dbPath}`);
                continue;
            }

            // Base64 解码并提取 refresh_token
            const buffer = Buffer.from(base64Data, 'base64');
            const refreshToken = parseProtobufForRefreshToken(buffer);

            if (refreshToken) {
                console.log(`[AntigravityTokenExtractor] Successfully extracted refresh_token from ${dbPath}`);
                return refreshToken;
            }
        } catch (error) {
            console.log(`[AntigravityTokenExtractor] Failed to extract from ${dbPath}: ${error}`);
        }
    }

    console.log('[AntigravityTokenExtractor] Failed to parse refresh_token from any database candidates');
    return null;
}

/**
 * 简单的 Protobuf 解析器 - 提取 refresh_token
 * refresh_token 位于 field 6 -> field 3
 */
function parseProtobufForRefreshToken(buffer: Buffer): string | null {
    try {
        // 先找到 field 6 (oauth data)
        const oauthData = findProtobufField(buffer, 6);
        if (!oauthData) {
            return null;
        }

        // 在 oauth data 中找到 field 3 (refresh_token)
        const refreshTokenBytes = findProtobufField(oauthData, 3);
        if (!refreshTokenBytes) {
            return null;
        }

        return refreshTokenBytes.toString('utf-8');
    } catch (error) {
        console.log('[AntigravityTokenExtractor] Protobuf parse error:', error);
        return null;
    }
}

/**
 * 在 Protobuf buffer 中查找指定 field number 的数据
 */
function findProtobufField(buffer: Buffer, fieldNumber: number): Buffer | null {
    let pos = 0;

    while (pos < buffer.length) {
        const { value: tag, newPos: tagEndPos } = readVarint(buffer, pos);
        if (tagEndPos >= buffer.length) {
            break;
        }

        const wireType = tag & 0x07;
        const field = tag >> 3;
        pos = tagEndPos;

        if (wireType === 2) {
            // Length-delimited (string, bytes, embedded messages)
            const { value: length, newPos: lenEndPos } = readVarint(buffer, pos);
            pos = lenEndPos;

            if (field === fieldNumber) {
                return buffer.slice(pos, pos + length);
            }
            pos += length;
        } else if (wireType === 0) {
            // Varint
            const { newPos } = readVarint(buffer, pos);
            pos = newPos;
        } else if (wireType === 1) {
            // 64-bit
            pos += 8;
        } else if (wireType === 5) {
            // 32-bit
            pos += 4;
        } else {
            // Unknown wire type, stop parsing
            break;
        }
    }

    return null;
}

/**
 * 读取 Varint 编码的整数
 * 使用 BigInt 避免超过 32 位时的溢出问题
 */
function readVarint(buffer: Buffer, pos: number): { value: number; newPos: number } {
    let result = BigInt(0);
    let shift = 0;

    while (pos < buffer.length) {
        const byte = buffer[pos];
        result |= BigInt(byte & 0x7f) << BigInt(shift);
        pos++;

        if ((byte & 0x80) === 0) {
            break;
        }
        shift += 7;

        // 防止无限循环：Varint 最多 10 字节（70 位）
        if (shift > 63) {
            break;
        }
    }

    // 转换为 number
    const numValue = result <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(result)
        : Number.MAX_SAFE_INTEGER;

    return { value: numValue, newPos: pos };
}

/**
 * 获取 sql.js 实例，并设置 wasm 定位
 */
async function getSqlInstance(): Promise<SqlJsStatic> {
    if (!sqlInitPromise) {
        // 在扩展环境中，wasm 文件位于 node_modules/sql.js/dist/
        const wasmPath = path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
        sqlInitPromise = initSqlJs({
            locateFile: () => wasmPath
        });
    }
    return sqlInitPromise;
}
