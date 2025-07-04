import fetch from 'node-fetch';
import { config } from '../config/config';

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

export async function verifyMinecraftUsername(username: string): Promise<{
    isValid: boolean;
    username?: string;
    uuid?: string;
    error?: string;
}> {
    try {
        const response = await fetch(`https://playerdb.co/api/player/minecraft/${username}`);
        const data = await response.json() as PlayerDBResponse;

        if (data.code === 'player.found') {
            return {
                isValid: true,
                username: data.data!.player.username, 
                uuid: data.data!.player.id
            };
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
        console.log(`[MinecraftUtils] API URL: ${config.apiBaseUrl}/punishment/profile/${uuid}`);
        
        const response = await fetch(`${config.apiBaseUrl}/punishment/profile/${uuid}`, {
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