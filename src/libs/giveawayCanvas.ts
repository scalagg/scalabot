import { createCanvas, loadImage, registerFont } from 'canvas';
import path from 'path';
import { serverUtils, ServerType } from '../utils/ServerUtils';

// Register fonts
registerFont(path.join(__dirname, '../../assets/fonts/Roboto-Bold.ttf'), { family: 'Roboto', weight: 'bold' });
registerFont(path.join(__dirname, '../../assets/fonts/Roboto-Regular.ttf'), { family: 'Roboto', weight: 'regular' });

const BG_PATHS = {
    [ServerType.SCALA]: path.join(__dirname, '../../assets/images/scala-bg.png'),
    [ServerType.HOLYPVP]: path.join(__dirname, '../../assets/images/welcome-bg.png'), // fallback
};

interface GiveawayImageOptions {
    prize: string;
    duration?: string;
    server: ServerType;
    winners?: string[];
    isWinner?: boolean;
    isReroll?: boolean;
}

export async function generateGiveawayImage(opts: GiveawayImageOptions): Promise<Buffer> {
    const width = 800;
    const height = 350;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Load background
    const bgPath = BG_PATHS[opts.server] || BG_PATHS[ServerType.SCALA];
    const bg = await loadImage(bgPath);
    ctx.drawImage(bg, 0, 0, width, height);

    // Overlay dark gradient
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, 'rgba(0,0,0,0.5)');
    grad.addColorStop(1, 'rgba(0,0,0,0.7)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Prize + Giveaway 
    ctx.font = 'bold 56px Roboto';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const prizeText = opts.prize;
    const giveawayText = ' Giveaway';
    const prizeWidth = ctx.measureText(prizeText).width;
    ctx.fillStyle = '#fff';
    const giveawayWidth = ctx.measureText(giveawayText).width;
    const totalWidth = prizeWidth + giveawayWidth;
    const startX = (width - totalWidth) / 2;
    // Draw prize in yellow
    ctx.fillStyle = '#FFD600';
    ctx.fillText(prizeText, startX, 48);
    // Draw 'Giveaway' in white
    ctx.fillStyle = '#fff';
    ctx.fillText(giveawayText, startX + prizeWidth, 48);

    // Duration or Winner label
    ctx.font = '32px Roboto';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    let label = '';
    if (opts.isWinner) {
        label = opts.isReroll ? 'Rerolled Winner!' : 'Winner!';
    } else if (opts.duration) {
        label = `Duration: ${opts.duration}`;
    }
    if (label) {
        ctx.fillText(label, width / 2, 120);
    }

    // Winner names (if any)
    if (opts.isWinner && opts.winners && opts.winners.length > 0) {
        ctx.font = '28px Roboto';
        ctx.fillStyle = '#FFD600';
        ctx.fillText(
            opts.winners.length === 1 ? opts.winners[0] : opts.winners.join(', '),
            width / 2,
            170
        );
    }

    // Server branding (bottom center)
    ctx.font = '24px Roboto';
    ctx.fillStyle = '#ccc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(
        opts.server === ServerType.SCALA ? 'Scala Network Giveaway' : 'HolyPvP Giveaway',
        width / 2,
        height - 32
    );

    return canvas.toBuffer('image/png');
} 