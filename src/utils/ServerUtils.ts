import { ColorResolvable } from 'discord.js';
import { GuildMember } from 'discord.js';

export enum ServerType {
    SCALA = 'SCALA',
    HOLYPVP = 'HOLYPVP'
}

interface ServerTheme {
    primary: ColorResolvable;
    secondary?: ColorResolvable; // Optional secondary color for gradients
    success: ColorResolvable;
    error: ColorResolvable;
    warning: ColorResolvable;
    info: ColorResolvable;
    neutral: ColorResolvable;
}

interface ServerInfo {
    name: string;
    website: string;
    ip: string;
    store: string;
    discord: string;
    logo?: string;
}

interface StaffRoles {
    staff: string[];      // All staff roles that can see tickets
    admin: string[];      // Admin roles with elevated permissions
    manager: string[];    // Manager roles with highest permissions
}

interface ServerConfig {
    theme: ServerTheme;
    info: ServerInfo;
    roles: StaffRoles;
}

const SCALA_CONFIG: ServerConfig = {
    theme: {
        primary: '#7289DA' as ColorResolvable,    // Discord blurple
        success: '#43B581' as ColorResolvable,    // Green
        error: '#F04747' as ColorResolvable,      // Red
        warning: '#FAA61A' as ColorResolvable,    // Orange
        info: '#5865F2' as ColorResolvable,       // Light blue
        neutral: '#2F3136' as ColorResolvable     // Dark gray
    },
    info: {
        name: 'Scala Network',
        website: 'https://scala.gg',
        ip: 'scala.gg',
        store: 'store.scala.gg',
        discord: 'discord.scala.gg',
        logo: 'https://i.imgur.com/JGiC6hP.png'
    },
    roles: {
        staff: [
            'Learner',
            'Trial Mod',
            'Mod',
            'Mod+',
            'Senior Mod',
            'Admin',
            'Senior Admin',
            'System Admin',
            'Platform Admin',
            'Co-Owner',
            'Owner'
        ],
        admin: [
            'Admin',
            'Senior Admin',
            'System Admin',
            'Platform Admin',
            'Co-Owner',
            'Owner'
        ],
        manager: [
            'Platform Admin',
            'System Admin',
            'Co-Owner',
            'Owner'
        ]
    }
};

const HOLYPVP_CONFIG: ServerConfig = {
    theme: {
        primary: '#FF6B6B' as ColorResolvable,    // Coral red
        success: '#4CAF50' as ColorResolvable,    // Green
        error: '#FF4444' as ColorResolvable,      // Red
        warning: '#FFA500' as ColorResolvable,    // Orange
        info: '#2196F3' as ColorResolvable,       // Blue
        neutral: '#2F3136' as ColorResolvable     // Dark gray
    },
    info: {
        name: 'HolyPvP',
        website: 'https://holypvp.net',
        ip: 'play.holypvp.net',
        store: 'store.holypvp.net',
        discord: 'discord.holypvp.net',
        logo: 'holypvp_logo.png'
    },
    roles: {
        staff: [
            'Helper',
            'Mod',
            'Senior Mod',
            'Admin',
            'Senior Admin',
            'Head Admin',
            'Manager',
            'Owner'
        ],
        admin: [
            'Admin',
            'Senior Admin',
            'Head Admin',
            'Manager',
            'Owner'
        ],
        manager: [
            'Manager',
            'Owner'
        ]
    }
};

export class ServerUtils {
    private static instance: ServerUtils;
    private serverType: ServerType = ServerType.SCALA; // Default to Scala

    private constructor() {}

    public static getInstance(): ServerUtils {
        if (!ServerUtils.instance) {
            ServerUtils.instance = new ServerUtils();
        }
        return ServerUtils.instance;
    }

    public setServerType(type: ServerType) {
        this.serverType = type;
    }

    public getConfig(): ServerConfig {
        return this.serverType === ServerType.SCALA ? SCALA_CONFIG : HOLYPVP_CONFIG;
    }

    public getTheme(): ServerTheme {
        return this.getConfig().theme;
    }

    public getInfo(): ServerInfo {
        return this.getConfig().info;
    }

    public getRoles(): StaffRoles {
        return this.getConfig().roles;
    }

    // Utility methods for common operations
    public getColor(type: keyof ServerTheme): ColorResolvable {
        const color = this.getTheme()[type];
        if (!color) {
            // Fallback to primary color if the requested color is undefined
            return this.getTheme().primary;
        }
        return color;
    }

    public getFooter(): { text: string; iconURL?: string } {
        const info = this.getInfo();
        const text = `${info.name} • ${info.website}`;
        return {
            text,
            iconURL: info.logo
        };
    }

    public getServerTypeFromGuildId(guildId: string): ServerType {
        // You can add guild IDs here to map them to server types
        const GUILD_MAP: Record<string, ServerType> = {
            '999774017223409714': ServerType.SCALA,      // Replace with actual Scala guild ID
            '536628675593109514': ServerType.HOLYPVP     // Replace with actual HolyPvP guild ID
        };
        return GUILD_MAP[guildId] || ServerType.SCALA; // Default to Scala if not found
    }

    public hasStaffRole(member: GuildMember): boolean {
        return member.roles.cache.some(role => this.getRoles().staff.includes(role.name));
    }

    public hasAdminRole(member: GuildMember): boolean {
        return member.roles.cache.some(role => this.getRoles().admin.includes(role.name));
    }

    public hasManagerRole(member: GuildMember): boolean {
        return member.roles.cache.some(role => this.getRoles().manager.includes(role.name));
    }

    public hasAdminOrHigherRole(member: GuildMember): boolean {
        const adminRoles = this.getRoles().admin;
        return member.roles.cache.some(role => adminRoles.includes(role.name));
    }

    public canWriteInClaimedTicket(member: GuildMember, claimedByUserId: string | null): boolean {
        // If not claimed, all staff can write
        if (!claimedByUserId) return this.hasStaffRole(member);

        // If claimed, only admins and the claimer can write
        return this.hasAdminOrHigherRole(member) || member.id === claimedByUserId;
    }

    public getRoleHierarchy(): string[] {
        return this.serverType === ServerType.SCALA ?
        // Scala role hierarchy
        [
            'Owner',
            'Co-Owner',
            'Platform Admin',
            'System Admin',
            'Senior Admin',
            'Admin',
            'Senior Mod',
            'Mod+',
            'Mod',
            'Trial Mod',
            'Learner'
        ] : 
        // HolyPvP role hierarchy
        [
            'Owner',
            'Manager',
            'Head Admin',
            'Senior Admin',
            'Admin',
            'Senior Mod',
            'Mod',
            'Helper'
        ];
    }

    public getRoleLevel(roleName: string): number {
        const hierarchy = this.getRoleHierarchy();
        const index = hierarchy.indexOf(roleName);
        return index === -1 ? -1 : hierarchy.length - index;
    }

    public getHighestRole(member: GuildMember): string | null {
        const hierarchy = this.getRoleHierarchy();
        const memberRoles = member.roles.cache.map(r => r.name);
        
        // Find the highest role the member has
        for (const role of hierarchy) {
            if (memberRoles.includes(role)) {
                return role;
            }
        }
        return null;
    }
}

// Export the singleton instance
export const serverUtils = ServerUtils.getInstance(); 