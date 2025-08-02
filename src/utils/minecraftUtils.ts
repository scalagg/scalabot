import fetch from 'node-fetch';
import { config } from '../config/config';
import { serverUtils } from './ServerUtils';
import dns from 'dns';
import { promisify } from 'util';
import { status } from 'minecraft-server-util';

const resolveSrv = promisify(dns.resolveSrv);

interface PlayerDBResponse {
    code: string;
    message: string;
    data?: {
        player: {
            username: string;
            id: string;
            raw_id: string;
            avatar: string;
        }
    }
}

interface MojangProfile {
    id: string;
    name: string;
    properties: Array<{
        name: string;
        value: string;
    }>;
}

interface Punishment {
    uuid: string;
    addedAt: number;
    addedBy: string;
    addedReason: string;
    category: string;
    duration: number;
    expireDate: string;
    removedAt: number;
    removedBy: string | null;
    removedReason: string | null;
    target: string;
}

interface MinecraftStatus {
    version: {
        name: string;
        protocol: number;
    };
    players: {
        max: number;
        online: number;
        sample?: Array<{
            name: string;
            id: string;
        }>;
    };
    description: string | {
        text?: string;
        extra?: Array<{
            text?: string;
            color?: string;
            bold?: boolean;
        }>;
    };
    favicon?: string;
}

interface McStatusResponse {
    online: boolean;
    host: string;
    port: number;
    version: {
        name_raw: string;
        name_clean: string;
        protocol: number;
    };
    players: {
        online: number;
        max: number;
        list: Array<{
            uuid: string;
            name_raw: string;
            name_clean: string;
            name_html: string;
        }>;
    };
    motd: {
        raw: string;
        clean: string;
        html: string;
    };
    icon?: string;
}

export async function verifyMinecraftUsername(username: string): Promise<{
    isValid: boolean;
    username?: string;
    uuid?: string;
    error?: string;
}> {
    // Normalize username: trim and lowercase for API, but preserve original for display
    const normalized = username.trim();
    console.log(`[verifyMinecraftUsername] Input: '${username}', Normalized: '${normalized}'`);
    try {
        const response = await fetch(`https://playerdb.co/api/player/minecraft/${encodeURIComponent(normalized)}`);
        const data = await response.json() as PlayerDBResponse;
        console.log(`[verifyMinecraftUsername] API response:`, data);
        if (data.code === 'player.found') {
            // Compare ignoring case
            if (data.data!.player.username.toLowerCase() === normalized.toLowerCase()) {
                return {
                    isValid: true,
                    username: data.data!.player.username, 
                    uuid: data.data!.player.id
                };
            } else {
                // Username found, but case mismatch (should still be valid)
                return {
                    isValid: true,
                    username: data.data!.player.username,
                    uuid: data.data!.player.id
                };
            }
        } else {
            return {
                isValid: false,
                error: 'Player not found'
            };
        }
    } catch (error) {
        console.error('[MinecraftUtils] Error verifying username:', error);
        return {
            isValid: false,
            error: 'Failed to verify username'
        };
    }
}

export async function getMinecraftUsername(uuid: string): Promise<string> {
    try {
        const response = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`);
        if (!response.ok) {
            throw new Error('Failed to fetch Minecraft username');
        }
        const data = await response.json() as MojangProfile;
        return data.name;
    } catch (error) {
        console.error('[ERROR] Failed to fetch Minecraft username:', error);
        throw error;
    }
}

export async function checkActivePunishments(uuid: string): Promise<{
    isBanned: boolean;
    isMuted: boolean;
    isBlacklisted: boolean;
    banExpiry?: number;
    muteExpiry?: number;
    blacklistExpiry?: number;
    banReason?: string;
    muteReason?: string;
    blacklistReason?: string;
}> {
    try {
        console.log(`[MinecraftUtils] Checking punishments for UUID: ${uuid}`);
        const apiUrl = serverUtils.getPunishmentProfileEndpoint(uuid);
        console.log(`[MinecraftUtils] API URL: ${apiUrl}`);
        
        const response = await fetch(apiUrl, {
            headers: {
                'Authorization': config.apiKey
            }
        });

        if (!response.ok) {
            console.error(`[MinecraftUtils] API returned status ${response.status}: ${response.statusText}`);
            console.error('[MinecraftUtils] Response:', await response.text());
            throw new Error('Failed to fetch punishments');
        }

        const punishments = await response.json() as Punishment[];
        console.log(`[MinecraftUtils] Raw punishments:`, punishments);
        
        // Find active punishments
        const now = Date.now();
        const activePunishments = punishments.filter(p => {
            // If removedAt exists and is not -1, the punishment is removed
            if (p.removedAt && p.removedAt !== -1) {
                console.log(`[MinecraftUtils] Punishment ${p.uuid} (${p.category}) was removed at ${new Date(p.removedAt).toISOString()}`);
                return false;
            }

            // Check if the punishment is active based on addedAt and duration
            const isActive = p.addedAt + p.duration > now;
            
            // Format dates safely
            const addedDate = new Date(p.addedAt).toISOString();
            const expiryDate = p.duration > 31536000000 ? "Never (Permanent)" : new Date(p.addedAt + p.duration).toISOString();
            
            console.log(`[MinecraftUtils] Punishment ${p.uuid} (${p.category}):
                Added: ${addedDate}
                Duration: ${p.duration}
                Expires: ${expiryDate}
                Active: ${isActive}
                Reason: ${p.addedReason}
                Removed: ${p.removedAt ? 'Yes' : 'No'}
                Removed Reason: ${p.removedReason || 'None'}`);
            
            return isActive;
        });

        console.log(`[MinecraftUtils] Active punishments:`, activePunishments);

        const activeBan = activePunishments.find(p => p.category === 'BAN');
        const activeMute = activePunishments.find(p => p.category === 'MUTE');
        const activeBlacklist = activePunishments.find(p => p.category === 'BLACKLIST');

        const result = {
            isBanned: !!activeBan,
            isMuted: !!activeMute,
            isBlacklisted: !!activeBlacklist,
            banExpiry: activeBan ? activeBan.addedAt + activeBan.duration : undefined,
            muteExpiry: activeMute ? activeMute.addedAt + activeMute.duration : undefined,
            blacklistExpiry: activeBlacklist ? activeBlacklist.addedAt + activeBlacklist.duration : undefined,
            banReason: activeBan?.addedReason,
            muteReason: activeMute?.addedReason,
            blacklistReason: activeBlacklist?.addedReason
        };

        console.log(`[MinecraftUtils] Final punishment status:`, result);
        return result;
    } catch (error) {
        console.error('[ERROR] Failed to check punishments:', error);
        throw error;
    }
}

/**
 * Resolve Minecraft server address including SRV records
 */
async function resolveMinecraftServer(domain: string): Promise<{ host: string; port: number }> {
    try {
        // Try to resolve SRV record
        const srvRecords = await resolveSrv(`_minecraft._tcp.${domain}`);
        if (srvRecords && srvRecords.length > 0) {
            return {
                host: srvRecords[0].name,
                port: srvRecords[0].port
            };
        }
    } catch (error) {
        console.log(`[MinecraftUtils] No SRV record found for ${domain}, using default port`);
    }

    // If no SRV record, return original domain with default port
    return {
        host: domain,
        port: 25565
    };
}

/**
 * Recursively extract text from MOTD description object
 */
function extractMotdText(description: any): string {
    if (typeof description === 'string') {
        return description;
    }

    let text = description.text || '';

    if (description.extra) {
        for (const part of description.extra) {
            if (typeof part === 'string') {
                text += part;
            } else {
                // Recursively extract text from nested extra arrays
                text += extractMotdText(part);
            }
        }
    }

    return text;
}

/**
 * Ping a Minecraft server to get its status using mcstatus.io API
 */
export async function pingServer(ip: string): Promise<{
    online: boolean;
    players?: {
        online: number;
        max: number;
    };
    ping?: number;
    motd?: string;
    rawMotd?: any;
    version?: string;
    icon?: string;
}> {
    try {
        console.log(`[MinecraftUtils] Fetching status for: ${ip}`);
        const response = await fetch(`https://api.mcstatus.io/v2/status/java/${ip}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json() as McStatusResponse;

        console.log(`[MinecraftUtils] Server status:`, data);
        
        if (!data.online) {
            return { online: false };
        }

        return {
            online: true,
            players: {
                online: data.players.online,
                max: data.players.max
            },
            motd: data.motd.clean,
            rawMotd: data.motd.html, // Using HTML version for better formatting
            version: data.version.name_clean,
            icon: data.icon
        };
    } catch (error) {
        console.error(`[MinecraftUtils] Failed to get server status for ${ip}:`, error);
        return {
            online: false
        };
    }
} 