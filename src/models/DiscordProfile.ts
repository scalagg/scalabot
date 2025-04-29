interface DiscordProfile {
    identifier: string; // UUID
    discordId?: string;
    lastCachedDiscordUsername?: string;
    notifiedOfSuccessfulLink: boolean;
    claimedInitialLinkAward: boolean;
}

export default DiscordProfile; 