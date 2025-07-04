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