import * as Sentry from '@sentry/node';
import { ProfilingIntegration } from '@sentry/profiling-node';
import { config } from '../config/config';

export class SentryService {
    private static instance: SentryService;
    private isInitialized = false;

    private constructor() {}

    public static getInstance(): SentryService {
        if (!SentryService.instance) {
            SentryService.instance = new SentryService();
        }
        return SentryService.instance;
    }

    public initialize(): void {
        if (this.isInitialized) {
            console.log('[SentryService] Already initialized');
            return;
        }

        // Only initialize if we have a DSN configured
        if (!config.sentryDsn) {
            console.log('[SentryService] No Sentry DSN configured, skipping initialization');
            return;
        }

        try {
            Sentry.init({
                dsn: config.sentryDsn,
                environment: config.environment || 'production',
                integrations: [
                    // Enable HTTP calls tracing
                    new Sentry.Integrations.Http({ tracing: true }),
                    // Enable Express.js middleware tracing
                    new Sentry.Integrations.Express({ app: undefined }),
                    // Automatically instrument Node.js libraries and frameworks
                    new Sentry.Integrations.Node({ 
                        // Don't instrument these modules
                        exclude: ['@sentry/node']
                    }),
                    // Enable profiling
                    new ProfilingIntegration(),
                ],
                // Performance Monitoring
                tracesSampleRate: 0.1, // Capture 10% of transactions
                // Set sampling rate for profiling - this is relative to tracesSampleRate
                profilesSampleRate: 0.1,
                // Enable debug mode in development
                debug: config.environment === 'development',
                // Before sending event to Sentry
                beforeSend(event, hint) {
                    // Filter out certain errors that we don't want to track
                    if (event.exception) {
                        const exception = event.exception.values?.[0];
                        if (exception) {
                            // Filter out Discord API errors that are expected
                            if (exception.value?.includes('Unknown interaction') ||
                                exception.value?.includes('Missing Access') ||
                                exception.value?.includes('Missing Permissions')) {
                                return null;
                            }
                        }
                    }
                    return event;
                },
                // Add custom tags
                initialScope: {
                    tags: {
                        bot: 'scalabot',
                        version: process.env.npm_package_version || '1.0.0'
                    }
                }
            });

            this.isInitialized = true;
            console.log('[SentryService] Initialized successfully');
        } catch (error) {
            console.error('[SentryService] Failed to initialize:', error);
        }
    }

    public captureException(error: Error, context?: Record<string, any>): void {
        if (!this.isInitialized) {
            console.error('[SentryService] Not initialized, cannot capture exception');
            return;
        }

        try {
            Sentry.withScope((scope) => {
                if (context) {
                    scope.setExtras(context);
                }
                Sentry.captureException(error);
            });
        } catch (sentryError) {
            console.error('[SentryService] Failed to capture exception:', sentryError);
        }
    }

    public captureMessage(message: string, level: Sentry.SeverityLevel = 'error', context?: Record<string, any>): void {
        if (!this.isInitialized) {
            console.error('[SentryService] Not initialized, cannot capture message');
            return;
        }

        try {
            Sentry.withScope((scope) => {
                if (context) {
                    scope.setExtras(context);
                }
                Sentry.captureMessage(message, level);
            });
        } catch (sentryError) {
            console.error('[SentryService] Failed to capture message:', sentryError);
        }
    }

    public setUser(userId: string, username?: string, guildId?: string): void {
        if (!this.isInitialized) return;

        try {
            Sentry.setUser({
                id: userId,
                username: username,
                ip_address: '{{auto}}'
            });

            if (guildId) {
                Sentry.setTag('guild_id', guildId);
            }
        } catch (error) {
            console.error('[SentryService] Failed to set user:', error);
        }
    }

    public setTag(key: string, value: string): void {
        if (!this.isInitialized) return;

        try {
            Sentry.setTag(key, value);
        } catch (error) {
            console.error('[SentryService] Failed to set tag:', error);
        }
    }

    public setContext(name: string, context: Record<string, any>): void {
        if (!this.isInitialized) return;

        try {
            Sentry.setContext(name, context);
        } catch (error) {
            console.error('[SentryService] Failed to set context:', error);
        }
    }

    public addBreadcrumb(breadcrumb: Sentry.Breadcrumb): void {
        if (!this.isInitialized) return;

        try {
            Sentry.addBreadcrumb(breadcrumb);
        } catch (error) {
            console.error('[SentryService] Failed to add breadcrumb:', error);
        }
    }

    public startTransaction(name: string, operation: string): Sentry.Transaction | undefined {
        if (!this.isInitialized) return undefined;

        try {
            return Sentry.startTransaction({
                name,
                op: operation
            });
        } catch (error) {
            console.error('[SentryService] Failed to start transaction:', error);
            return undefined;
        }
    }

    public flush(timeout?: number): Promise<boolean> {
        if (!this.isInitialized) return Promise.resolve(false);

        try {
            return Sentry.flush(timeout);
        } catch (error) {
            console.error('[SentryService] Failed to flush:', error);
            return Promise.resolve(false);
        }
    }

    public close(): Promise<void> {
        if (!this.isInitialized) return Promise.resolve();

        try {
            return Sentry.close();
        } catch (error) {
            console.error('[SentryService] Failed to close:', error);
            return Promise.resolve();
        }
    }
}

export const sentryService = SentryService.getInstance();
