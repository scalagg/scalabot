import { 
    Client, 
    GuildMember, 
    TextChannel, 
    AttachmentBuilder,
    EmbedBuilder
} from 'discord.js';
import { createCanvas, loadImage, registerFont } from 'canvas';
import { join } from 'path';
import { serverUtils, ServerType } from '../utils/ServerUtils';
import { config } from '../config/config';
import { mongoService } from './MongoService';
import { sentryService } from './SentryService';
import fetch from 'node-fetch';

interface PlayerData {
    username: string;
    uuid: string;
    rank?: string;
    rankColor?: string;
    level?: number;
    guild?: string;
    guildTag?: string;
    firstJoin?: Date;
}

interface WelcomeImageOptions {
    member: GuildMember;
    playerData?: PlayerData;
    memberCount: number;
}

export class WelcomeService {
    private static instance: WelcomeService;
    private client!: Client;
    private fontsRegistered = false;

    private constructor() {
        this.registerFonts();
    }

    public static getInstance(): WelcomeService {
        if (!WelcomeService.instance) {
            WelcomeService.instance = new WelcomeService();
        }
        return WelcomeService.instance;
    }

    private registerFonts(): void {
        if (this.fontsRegistered) return;
        
        try {
            // Register fonts from assets
            registerFont(join(process.cwd(), 'assets', 'fonts', 'Roboto-Bold.ttf'), { 
                family: 'Roboto', 
                weight: 'bold' 
            });
            registerFont(join(process.cwd(), 'assets', 'fonts', 'Roboto-Regular.ttf'), { 
                family: 'Roboto', 
                weight: 'normal' 
            });
            this.fontsRegistered = true;
            console.log('[WelcomeService] Fonts registered successfully');
        } catch (error) {
            console.warn('[WelcomeService] Failed to register fonts, using system fonts:', error);
            this.fontsRegistered = true;
        }
    }

    public setClient(client: Client) {
        this.client = client;
    }

    public async handleMemberJoin(member: GuildMember): Promise<void> {
        try {
            // Set server type
            const serverType = serverUtils.getServerTypeFromGuildId(member.guild.id);
            serverUtils.setServerType(serverType);

            if (serverType === ServerType.HOLYPVP) {
                await this.sendSimpleWelcomeMessage(member);
            } else {
                // For Scala, use the full welcome image system
                let playerData: PlayerData | undefined;
                playerData = await this.getPlayerData(member.id);

                // Create welcome image
                const imageBuffer = await this.createWelcomeImage({
                    member,
                    playerData,
                    memberCount: member.guild.memberCount
                });

                // Send welcome message
                await this.sendWelcomeMessage(member, imageBuffer, playerData);
            }

        } catch (error) {
            console.error('[WelcomeService] Error handling member join:', error);
            sentryService.captureException(error as Error, {
                context: 'welcome_member_join',
                user_id: member.id,
                guild_id: member.guild.id,
                server_type: serverUtils.getServerTypeFromGuildId(member.guild.id)
            });
        }
    }

    public async handleVerificationWelcome(member: GuildMember, minecraftUsername: string, uuid: string): Promise<void> {
        try {
            const serverType = serverUtils.getServerTypeFromGuildId(member.guild.id);
            serverUtils.setServerType(serverType);

            if (serverType === ServerType.HOLYPVP) {
                // For HolyPvP, send simple text message
                await this.sendSimpleWelcomeMessage(member);
            } else {
                // For Scala, use the full welcome image system
                const playerData = await this.getPlayerDataByUuid(uuid);
                const imageBuffer = await this.createWelcomeImage({
                    member,
                    playerData,
                    memberCount: member.guild.memberCount
                });
                await this.sendWelcomeMessage(member, imageBuffer, playerData);
            }
        } catch (error) {
            console.error('[WelcomeService] Error handling verification welcome:', error);
        }
    }

    public async generateTestImage(member: GuildMember, testData?: PlayerData): Promise<Buffer> {
        try {
            // Set server type
            serverUtils.setServerType(serverUtils.getServerTypeFromGuildId(member.guild.id));

            // Create welcome image with test data
            const imageBuffer = await this.createWelcomeImage({
                member,
                playerData: testData,
                memberCount: member.guild.memberCount
            });

            return imageBuffer;
        } catch (error) {
            console.error('[WelcomeService] Error generating test image:', error);
            throw error;
        }
    }

    private async getPlayerData(discordId: string): Promise<PlayerData | undefined> {
        try {
            const collection = mongoService.getCollection('DiscordProfiles');
            const profile = await collection.findOne({ discordId });
            
            if (!profile) return undefined;

            // You can extend this to fetch more player data from your API
            // For now, we'll return basic info
            return {
                username: profile.lastCachedDiscordUsername || 'Unknown',
                uuid: profile.identifier,
                rank: 'NONE', // You can fetch this from your API
                rankColor: '#AAAAAA',
                level: 0 // You can fetch this from your API
            };
        } catch (error) {
            console.warn('[WelcomeService] Error fetching player data:', error);
            return undefined;
        }
    }

    private async getPlayerDataByUuid(uuid: string): Promise<PlayerData | undefined> {
        try {
            // Fetch profile
            const profileRes = await fetch(serverUtils.getProfileEndpoint(uuid), {
                headers: { Authorization: config.apiKey }
            });
            if (!profileRes.ok) return undefined;
            const profile: any = await profileRes.json();
            // Fetch grants
            const grantsRes = await fetch(serverUtils.getGrantsEndpoint(uuid), {
                headers: { Authorization: config.apiKey }
            });
            const grants: any[] = grantsRes.ok ? (await grantsRes.json() as any[]) : [];
            // Fetch level from coreplayerprofile endpoint
            let level: number | undefined = undefined;
            try {
                const coreProfileRes = await fetch(serverUtils.getCoreProfileEndpoint(uuid), {
                    headers: { Authorization: config.apiKey }
                });
                if (coreProfileRes.ok) {
                    const coreProfile: any = await coreProfileRes.json();
                    if (typeof coreProfile.level === 'number') {
                        level = coreProfile.level;
                    }
                }
            } catch (err) {
                console.warn('[WelcomeService] Error fetching coreplayerprofile for level:', err);
            }
            console.log('[WelcomeService][DEBUG] Profile:', profile.name, profile.uniqueId);
            console.log('[WelcomeService][DEBUG] Grants:', grants);
            // Find highest-weight active grant
            const activeGrants = grants.filter((g: any) => g.removedAt === -1);
            console.log('[WelcomeService][DEBUG] Active Grants:', activeGrants);
            let rank = 'Default';
            let rankColor = '#AAAAAA';
            let rankId = undefined;
            let rankDetails = undefined;
            let highestWeight = -Infinity;
            let selectedGrant = undefined;
            let selectedRankDetails = undefined;
            // For each active grant, fetch rank and compare weight, only if visible
            for (const grant of activeGrants) {
                const thisRankId = grant.rankId;
                if (!thisRankId) continue;
                const rankEndpoint = serverUtils.getRankEndpoint(thisRankId);
                console.log('[WelcomeService][DEBUG] Fetching rank details from:', rankEndpoint);
                try {
                    const rankRes = await fetch(rankEndpoint, { headers: { Authorization: config.apiKey } });
                    if (rankRes.ok) {
                        const thisRankDetails: any = await rankRes.json();
                        const thisWeight = thisRankDetails.weight ?? 0;
                        const isVisible = thisRankDetails.visible !== false;
                        console.log(`[WelcomeService][DEBUG] Grant ${grant.uuid} rankId ${thisRankId} weight:`, thisWeight, 'visible:', isVisible, 'details:', thisRankDetails);
                        if (!isVisible) continue;
                        if (thisWeight > highestWeight) {
                            highestWeight = thisWeight;
                            selectedGrant = grant;
                            selectedRankDetails = thisRankDetails;
                        }
                    } else {
                        console.log('[WelcomeService][DEBUG] Failed to fetch rank details, status:', rankRes.status);
                    }
                } catch (err) {
                    console.log('[WelcomeService][DEBUG] Error fetching rank details:', err);
                }
            }
            if (selectedGrant && selectedRankDetails) {
                // Use prefix and color
                let prefix = selectedRankDetails.prefix || '';
                let rankName = selectedRankDetails.name || 'Rank';
                // Extract color from prefix (prefer color before rank name)
                let extractedColor = extractRankColorFromPrefix(prefix, rankName)
                    || (selectedRankDetails.color && /§[0-9a-f]/i.test(selectedRankDetails.color) ? mcColorToHex(selectedRankDetails.color.replace('§', '')) : selectedRankDetails.color)
                    || '#AAAAAA';
                console.log('[WelcomeService][DEBUG] Selected Grant:', selectedGrant, 'with prefix:', prefix, 'name:', rankName, 'color:', extractedColor);
                rank = prefix ? stripMinecraftCodes(prefix) : rankName;
                rankColor = extractedColor;
            } else if (activeGrants.length > 0) {
                const grant = activeGrants[0];
                rank = grant.addedReason || 'Rank';
                console.log('[WelcomeService][DEBUG] No visible rank found, using grant addedReason:', rank);
            } else {
                console.log('[WelcomeService][DEBUG] No active grants found, using Default rank.');
            }
            // First join
            let firstJoin = undefined;
            if (profile.metadata && profile.metadata['first-connection']) {
                const ms = Number(profile.metadata['first-connection'].value);
                if (!isNaN(ms)) firstJoin = new Date(ms);
            }
            return {
                username: profile.name,
                uuid: profile.uniqueId,
                rank,
                rankColor,
                level,
                guild: undefined,
                guildTag: undefined,
                firstJoin
            };
        } catch (error) {
            console.warn('[WelcomeService] Error fetching player data from Scala REST API:', error);
            return undefined;
        }
    }

    private async createWelcomeImage(options: WelcomeImageOptions): Promise<Buffer> {
        const { member, playerData, memberCount } = options;
        const serverType = serverUtils.getServerTypeFromGuildId(member.guild.id);
        
        // Canvas dimensions
        const width = 800;
        const height = 470;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        try {
            // Load background based on server type
            const backgroundPath = this.getBackgroundPath(serverType);
            const background = await this.loadImage(backgroundPath);
            ctx.drawImage(background, 0, 0, width, height);

            // Add dark overlay
            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.fillRect(0, 0, width, height);

            // Load and draw frames
            await this.drawFrames(ctx, width, height);

            // Use Discord avatar for HolyPvP, MC skin for Scala
            let avatarUrl: string;
            if (serverType === ServerType.HOLYPVP) {
                // For HolyPvP, always use Discord avatar
                avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 256 });
            } else {
                // For Scala, use MC skin if available, fallback to Discord avatar
                avatarUrl = playerData?.uuid ? `https://skins.mcstats.com/bust/${playerData.uuid}` : member.user.displayAvatarURL({ extension: 'png', size: 256 });
            }
            const avatar = await this.loadImage(avatarUrl);

            // Draw avatar with frame
            const avatarSize = 128;
            const avatarX = 562;
            const avatarY = height / 2 - 80;
            ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);

            // Draw gradient overlay on avatar area
            ctx.globalAlpha = 0.8;
            const gradient = await this.loadImage(join(process.cwd(), 'assets', 'images', 'gradient.png'));
            ctx.drawImage(gradient, 546, height / 2 + 7);
            ctx.globalAlpha = 1;

            // Draw text content
            await this.drawTextContent(ctx, member, playerData, memberCount, serverType);

            return canvas.toBuffer('image/png');

        } catch (error) {
            console.error('[WelcomeService] Error creating welcome image:', error);
            // Return a fallback image
            return this.createFallbackImage(member, memberCount);
        }
    }

    private getBackgroundPath(serverType: ServerType): string {
        switch (serverType) {
            case ServerType.SCALA:
                return join(process.cwd(), 'assets', 'images', 'scala-bg.png');
            case ServerType.HOLYPVP:
                return join(process.cwd(), 'assets', 'images', 'welcome-bg.png');
            default:
                return join(process.cwd(), 'assets', 'images', 'scala-bg.png');
        }
    }

    private async loadImage(path: string): Promise<any> {
        try {
            return await loadImage(path);
        } catch (error) {
            console.warn(`[WelcomeService] Failed to load image: ${path}`, error);
            // Create a fallback colored rectangle
            const canvas = createCanvas(100, 100);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#1a1a2e';
            ctx.fillRect(0, 0, 100, 100);
            return canvas as any;
        }
    }

    private async drawFrames(ctx: any, width: number, height: number): Promise<void> {
        try {
            // Draw main frame
            const frame = await this.loadImage(join(process.cwd(), 'assets', 'images', 'frame.png'));
            ctx.globalAlpha = 0.9;
            ctx.drawImage(frame, 500, height / 2 - 115);
            
            // Draw secondary frame
            const frame2 = await this.loadImage(join(process.cwd(), 'assets', 'images', 'frame2.png'));
            ctx.drawImage(frame2, -20, height / 2 - 120);
            ctx.globalAlpha = 1;
        } catch (error) {
            console.warn('[WelcomeService] Error drawing frames:', error);
        }
    }

    private async drawTextContent(ctx: any, member: GuildMember, playerData: PlayerData | undefined, memberCount: number, serverType: ServerType): Promise<void> {
        const startX = 30;
        const startY = 200;
        const lineHeight = 40;
        
        // Draw welcome message with rank
        let rankDisplay = playerData?.rank && playerData.rank !== 'NONE' ? playerData.rank : undefined;
        // Remove brackets if present for join message
        if (rankDisplay && rankDisplay.startsWith('[') && rankDisplay.endsWith(']')) {
            rankDisplay = rankDisplay.substring(1, rankDisplay.length - 1);
        }
        const rankColor = playerData?.rankColor || '#AAAAAA';
        const username = playerData?.username || member.user.username;
        const rankText = rankDisplay ? `${rankDisplay} ${username}` : username;
        await this.drawRankString(ctx, rankText, rankColor, startX, 80);
        
        ctx.font = '25px Roboto';
        ctx.textAlign = 'left';
        this.drawInfoLine(ctx, 'Discord:', member.user.tag, startX, startY, '#5555FF', '#FFFFFF');
        
        if (serverType === ServerType.HOLYPVP) {
            // For HolyPvP, show simplified info - just Discord data
            this.drawInfoLine(ctx, 'Status:', 'Member', startX, startY + lineHeight, '#55FF55', '#FFFFFF');
            this.drawInfoLine(ctx, 'Type:', 'Discord User', startX, startY + lineHeight * 2, '#FFAA00', '#FFFFFF');
        } else {
            // For Scala, show Minecraft rank and level info
            this.drawInfoLine(ctx, 'Rank:', rankDisplay || 'Default', startX, startY + lineHeight, rankColor, '#FFFFFF');
            this.drawInfoLine(ctx, 'Level:', playerData?.level !== undefined ? playerData.level.toString() : 'N/A', startX, startY + lineHeight * 2, '#FFAA00', '#FFFFFF');
        }
        
        // First join (only show for Scala with Minecraft data)
        if (serverType !== ServerType.HOLYPVP && playerData && (playerData as any).firstJoin instanceof Date) {
            ctx.globalAlpha = 0.7;
            ctx.font = '17px Roboto';
            ctx.fillStyle = '#55FF55';
            ctx.fillText('First joined on', startX, 360);
            ctx.font = '15px Roboto';
            ctx.fillStyle = '#FFFFFF';
            const d = (playerData as any).firstJoin;
            const firstJoinText = `${d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`;
            ctx.fillText(firstJoinText, startX, 380);
            ctx.globalAlpha = 1;
        }
        
        // Discord account creation (show for both servers)
        ctx.font = '17px Roboto';
        ctx.fillStyle = '#5555FF';
        ctx.fillText('Discord account created on', startX, 400);
        ctx.font = '15px Roboto';
        ctx.fillStyle = '#FFFFFF';
        const createdDate = member.user.createdAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const yearsAgo = Math.floor((Date.now() - member.user.createdAt.getTime()) / (1000 * 60 * 60 * 24 * 365));
        ctx.fillText(`${createdDate} (${yearsAgo} years ago)`, startX, 420);
        ctx.globalAlpha = 1;
        
        // Move member count to bottom left, styled nicely
        ctx.font = '18px Roboto';
        ctx.fillStyle = '#BBBBBB';
        ctx.textAlign = 'left';
        ctx.fillText(`Member #${memberCount}`, startX, 455);
    }

    private async drawRankString(ctx: any, text: string, rankColor: string, x: number, y: number): Promise<void> {
        ctx.font = '25px Roboto';
        ctx.textAlign = 'left';
        let currentX = x;
        // Subtle shadow for rank text
        ctx.shadowColor = this.darkenColor(rankColor, 2);
        ctx.shadowBlur = 6;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        ctx.fillStyle = rankColor;
        ctx.fillText(text, currentX, y);
        ctx.shadowBlur = 0;
        currentX += ctx.measureText(text).width + 8;
        // Subtle shadow for yellow join message
        ctx.shadowColor = this.darkenColor('#FFFF55', 2);
        ctx.shadowBlur = 6;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        ctx.fillStyle = '#FFFF55';
        ctx.fillText(' has joined the server!', currentX, y);
        ctx.shadowBlur = 0;
    }

    private drawInfoLine(ctx: any, label: string, value: string, x: number, y: number, labelColor: string, valueColor: string): void {
        ctx.fillStyle = labelColor;
        ctx.fillText(label, x, y);
        
        const labelWidth = ctx.measureText(label).width;
        ctx.fillStyle = valueColor;
        ctx.fillText(`  ${value}`, x + labelWidth, y);
    }

    private darkenColor(color: string, amount: number): string {
        // Simple color darkening - you can use a proper color library for better results
        const hex = color.replace('#', '');
        const r = Math.max(0, parseInt(hex.substr(0, 2), 16) - amount * 10);
        const g = Math.max(0, parseInt(hex.substr(2, 2), 16) - amount * 10);
        const b = Math.max(0, parseInt(hex.substr(4, 2), 16) - amount * 10);
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    private createFallbackImage(member: GuildMember, memberCount: number): Buffer {
        const width = 800;
        const height = 470;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        // Create gradient background
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, '#1a1a2e');
        gradient.addColorStop(1, '#16213e');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        // Draw simple welcome text
        ctx.font = 'bold 48px Roboto';
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.fillText(`${member.user.username} has joined the server!`, width / 2, height / 2);

        ctx.font = '24px Roboto';
        ctx.fillText(`Member #${memberCount}`, width / 2, height / 2 + 50);

        return canvas.toBuffer('image/png');
    }

    private async sendSimpleWelcomeMessage(member: GuildMember): Promise<void> {
        try {
            const welcomeChannel = await this.client.channels.fetch(config.welcomeChannelId) as TextChannel;
            if (!welcomeChannel) {
                console.warn('[WelcomeService] Welcome channel not found');
                return;
            }

            // Send simple text message for HolyPvP
            await welcomeChannel.send({
                content: `Welcome to the **HolyPvP Network** Discord, ${member}!`
            });

        } catch (error) {
            console.error('[WelcomeService] Error sending simple welcome message:', error);
        }
    }

    private async sendWelcomeMessage(member: GuildMember, imageBuffer: Buffer, playerData?: PlayerData): Promise<void> {
        try {
            const welcomeChannel = await this.client.channels.fetch(config.welcomeChannelId) as TextChannel;
            if (!welcomeChannel) {
                console.warn('[WelcomeService] Welcome channel not found');
                return;
            }

            const attachment = new AttachmentBuilder(imageBuffer, { name: 'welcome.png' });

            // Send only a ping and the image, no embed
            await welcomeChannel.send({
                content: `Welcome to the server, ${member}!`,
                files: [attachment]
            });

        } catch (error) {
            console.error('[WelcomeService] Error sending welcome message:', error);
        }
    }
}

export const welcomeService = WelcomeService.getInstance();

// Move helpers to top-level for shared use
const mcColorMap: Record<string, string> = {
    '0': '#000000',
    '1': '#0000AA',
    '2': '#00AA00',
    '3': '#00AAAA',
    '4': '#AA0000',
    '5': '#AA00AA',
    '6': '#FFAA00',
    '7': '#AAAAAA',
    '8': '#555555',
    '9': '#5555FF',
    'a': '#55FF55',
    'b': '#55FFFF',
    'c': '#FF5555',
    'd': '#FF55FF',
    'e': '#FFFF55',
    'f': '#FFFFFF'
};
function mcColorToHex(code: string): string {
    return mcColorMap[code.toLowerCase()] || '#AAAAAA';
}
function extractRankColorFromPrefix(prefix: string, rankName: string): string | undefined {
    // Try to find the last color code before the rank name
    const regex = new RegExp(`§([0-9a-f])(?=[^§]*${rankName})`, 'i');
    const match = prefix.match(regex);
    if (match) {
        return mcColorToHex(match[1]);
    }
    // Fallback: use the first color code in the prefix
    const first = prefix.match(/§([0-9a-f])/i);
    if (first) {
        return mcColorToHex(first[1]);
    }
    return undefined;
}
function stripMinecraftCodes(str: string): string {
    return str.replace(/§[0-9a-fklmnor]/gi, '');
} 