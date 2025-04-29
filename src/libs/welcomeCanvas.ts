import { createCanvas, loadImage, registerFont, Canvas } from 'canvas';
import { join } from 'path';
import { GuildMember } from 'discord.js';

export class WelcomeCanvas {
  private static instance: WelcomeCanvas;
  private fontsRegistered: boolean = false;
  private defaultBackgroundPath: string;

  private constructor() {
    this.defaultBackgroundPath = join(process.cwd(), 'assets', 'images', 'welcome-bg.png');
    this.registerFonts();
  }

  public static getInstance(): WelcomeCanvas {
    if (!WelcomeCanvas.instance) {
      WelcomeCanvas.instance = new WelcomeCanvas();
    }
    return WelcomeCanvas.instance;
  }

  private registerFonts(): void {
    if (this.fontsRegistered) return;
    try {
      registerFont(join(process.cwd(), 'assets', 'fonts', 'Roboto-Bold.ttf'), { family: 'Roboto', weight: 'bold' });
      registerFont(join(process.cwd(), 'assets', 'fonts', 'Roboto-Regular.ttf'), { family: 'Roboto' });
      this.fontsRegistered = true;
    } catch (error) {
      console.warn('Failed to register fonts, falling back to system fonts:', error);
      this.fontsRegistered = true;
    }
  }

  private async loadBackgroundImage(backgroundPath?: string): Promise<any> {
    try {
      return await loadImage(backgroundPath || this.defaultBackgroundPath);
    } catch (error) {
      console.warn('Failed to load background image, using gradient background:', error);
      const canvas = createCanvas(1024, 500);
      const ctx = canvas.getContext('2d');
      const gradient = ctx.createLinearGradient(0, 0, 1024, 500);
      gradient.addColorStop(0, '#000000');
      gradient.addColorStop(1, '#1a1a2e');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 1024, 500);
      return canvas as unknown as any;
    }
  }

  private formatDate(date: Date): string {
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const years = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24 * 365));
    return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()} (${years} years ago)`;
  }

  public async createCustomWelcomeImage(
    member: GuildMember,
    options: {
      backgroundPath?: string;
      welcomeText?: string;
      guildName?: string;
      level?: number;
      usernameColor?: string;
      memberCountColor?: string;
      customFont?: string;
    } = {}
  ): Promise<Buffer> {
    const width = 800;
    const height = 250;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    try {
      // Draw background
      const background = await this.loadBackgroundImage(options.backgroundPath);
      ctx.drawImage(background, 0, 0, width, height);

      // Draw semi-transparent dark box
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(30, height/2 - 70, width - 60, 140);

      // Draw join message at the top
      ctx.save();
      ctx.font = 'bold 28px Roboto, sans-serif';
      const joinMessage = `${member.user.username} has joined the server!`;
      ctx.fillStyle = '#00ffff'; // Cyan color for username
      ctx.fillText(member.user.username, 50, 50);
      ctx.fillStyle = '#ffff00'; // Yellow color for message
      ctx.fillText(' has joined the server!', 50 + ctx.measureText(member.user.username).width, 50);
      ctx.restore();

      // Draw user info
      const startX = 50;
      const startY = height/2 - 30;
      const lineHeight = 35;

      // Discord tag
      ctx.save();
      ctx.font = '24px Roboto, sans-serif';
      ctx.fillStyle = '#6666ff'; // Discord blue
      ctx.fillText('Discord:', startX, startY);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(` ${member.user.tag}`, startX + 90, startY);
      ctx.restore();

      // Rank name
      ctx.save();
      ctx.font = '24px Roboto, sans-serif';
      ctx.fillStyle = '#00ff00'; // Green
      ctx.fillText('Rank:', startX, startY + lineHeight);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(` Owner`, startX + 70, startY + lineHeight);
      ctx.restore();

      // Level 
      if (options.level) {
        ctx.save();
        ctx.font = '24px Roboto, sans-serif';
        ctx.fillStyle = '#ffa500'; // Orange
        ctx.fillText('Level:', startX, startY + lineHeight * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(` ${options.level}`, startX + 70, startY + lineHeight * 2);
        ctx.restore();
      }

      // Account creation date 
      ctx.save();
      ctx.font = '18px Roboto, sans-serif';
      ctx.fillStyle = '#6666ff'; // Discord blue
      ctx.textAlign = 'left';
      ctx.fillText('Discord account created on', startX + 40, height - 32);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(` ${this.formatDate(member.user.createdAt)}`, startX + 260, height - 32);
      ctx.restore();

      // Draw member count
      ctx.save();
      ctx.font = '20px Roboto, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'right';
      ctx.fillText(`Member #${member.guild.memberCount}`, width - 50, height - 20);
      ctx.restore();

      // Draw avatar on the right
      const avatarSize = 120;
      const avatarX = width - avatarSize - 50;
      const avatarY = height/2 - avatarSize/2;
      const avatarURL = member.user.displayAvatarURL({ extension: 'png', size: 256 });
      const avatar = await loadImage(avatarURL);

      // Draw avatar background/border
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(avatarX - 5, avatarY - 5, avatarSize + 10, avatarSize + 10, 10);
      ctx.fillStyle = '#000000';
      ctx.fill();
      ctx.restore();

      // Draw avatar
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(avatarX, avatarY, avatarSize, avatarSize, 8);
      ctx.clip();
      ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
      ctx.restore();

      return canvas.toBuffer();
    } catch (error) {
      console.error('Error creating custom welcome image:', error);
      throw error;
    }
  }
} 