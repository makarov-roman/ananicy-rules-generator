declare module "steam-user" {
  class SteamUser {
    logOn(options: { anonymous: true }): void;
    logOff(): void;
    on(event: "loggedOn", listener: () => void): this;
    on(event: "error", listener: (err: Error) => void): this;
    getProductInfo(
      apps: number[],
      packages: number[],
      inclTokens?: boolean
    ): Promise<{ apps: Record<string, { appinfo: any }> }>;
  }
  export = SteamUser;
}
