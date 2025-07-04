import { SlashCommandBuilder, ChatInputCommandInteraction, ColorResolvable } from 'discord.js';
import { createCanvas, loadImage, registerFont } from 'canvas';
import { serverUtils, ServerType } from '../utils/ServerUtils';
import { pingServer } from '../utils/minecraftUtils';
import path from 'path';

// Register Roboto fonts
registerFont(path.join(process.cwd(), 'assets', 'fonts', 'Roboto-Regular.ttf'), { family: 'Roboto' });
registerFont(path.join(process.cwd(), 'assets', 'fonts', 'Roboto-Bold.ttf'), { family: 'Roboto Bold' });

export const data = new SlashCommandBuilder()
    .setName('status')
    .setDescription('Check the server status with a beautiful display');

/**
 * Convert a Discord.js ColorResolvable to a string color
 */
function resolveColor(color: ColorResolvable): string {
    if (typeof color === 'string') {
        if (color.startsWith('#')) return color;
        return color;
    }
    if (typeof color === 'number') {
        return `#${color.toString(16).padStart(6, '0')}`;
    }
    if (Array.isArray(color)) {
        const [r, g, b] = color;
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }
    return '#000000';
}

async function drawServerStatus(
    serverType: ServerType,
    status: { online: boolean; players?: { online: number; max: number }; ping?: number }
) {
    try {
        serverUtils.setServerType(serverType);
        const config = serverUtils.getConfig();
        const theme = config.theme;

        // Canvas setup
        const canvas = createCanvas(900, 280);
        const ctx = canvas.getContext('2d');

        // Clear any existing content
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw background
        try {
            const bgPath = path.join(process.cwd(), 'assets', 'images', 
                serverType === ServerType.SCALA ? 'scala-bg.png' : 'holy-bg.png'
            );
            const background = await loadImage(bgPath);
            ctx.drawImage(background, 0, 0, canvas.width, canvas.height);
            
            // Add dark overlay
            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        } catch (error) {
            console.error('Failed to load background image:', error);
            ctx.fillStyle = resolveColor(theme.neutral);
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        // Draw server logo
        try {
            const logo = await loadImage(config.info.logo || path.join(process.cwd(), 'assets', 'images', 'default-logo.png'));
            const logoSize = 100;
            const logoX = 40;
            const logoY = 40;
            ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);
        } catch (error) {
            console.error('Failed to load server logo:', error);
        }

        // Server name
        const primaryColor = resolveColor(theme.primary);
        ctx.font = '48px "Roboto Bold"';
        ctx.fillStyle = primaryColor;
        ctx.fillText(config.info.name, 160, 90);

        // Server IP
        ctx.font = '24px Roboto';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(config.info.ip, 160, 130);

        // Status section
        const statusY = 180;
        
        // Status indicator
        const statusColor = resolveColor(status.online ? theme.success : theme.error);
        ctx.beginPath();
        ctx.arc(180, statusY, 8, 0, Math.PI * 2);
        ctx.fillStyle = statusColor;
        ctx.fill();

        // Status text
        ctx.font = '32px "Roboto Bold"';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText('ONLINE', 200, statusY + 10);

        if (status.online && status.players) {
            // Player count
            const centerX = canvas.width / 2;
            const playerText = `${status.players.online}/${status.players.max}`;
            ctx.font = '32px "Roboto Bold"';
            ctx.fillStyle = '#FFFFFF';
            const playerWidth = ctx.measureText(playerText).width;
            ctx.fillText(playerText, centerX - playerWidth / 2, statusY + 10);

            // Players label
            ctx.font = '16px Roboto';
            ctx.fillStyle = '#CCCCCC';
            const labelWidth = ctx.measureText('PLAYERS').width;
            ctx.fillText('PLAYERS', centerX - labelWidth / 2, statusY + 35);

            // Ping
            if (status.ping !== undefined) {
                const pingColor = resolveColor(
                    status.ping < 100 ? theme.success :
                    status.ping < 200 ? theme.warning :
                    theme.error
                );
                
                const pingText = status.ping.toString();
                ctx.font = '32px "Roboto Bold"';
                ctx.fillStyle = pingColor;
                ctx.fillText(pingText, canvas.width - 200, statusY + 10);

                ctx.font = '16px Roboto';
                ctx.fillStyle = '#CCCCCC';
                ctx.fillText('MS', canvas.width - 180, statusY + 35);
            }
        }

        // Bottom bar
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.fillRect(0, canvas.height - 40, canvas.width, 40);

        // Links
        ctx.font = '18px Roboto';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(`${config.info.website} • ${config.info.discord}`, 20, canvas.height - 14);

        return canvas.toBuffer();
    } catch (error) {
        console.error('Error generating status image:', error);
        throw error;
    }
}

export async function execute(interaction: ChatInputCommandInteraction) {
    try {
        await interaction.deferReply();

        const serverType = serverUtils.getServerTypeFromGuildId(interaction.guildId || '');
        serverUtils.setServerType(serverType);
        const config = serverUtils.getConfig();

        console.log(`[Status] Pinging ${config.info.ip}...`);
        const status = await pingServer(config.info.ip);
        console.log(`[Status] Server status:`, status);

        const statusImage = await drawServerStatus(serverType, status);

        await interaction.editReply({
            files: [{
                attachment: statusImage,
                name: 'server-status.png'
            }]
        });
    } catch (error) {
        console.error('[Status] Error executing status command:', error);
        await interaction.editReply('❌ Failed to check server status. Please try again later.');
    }
} 