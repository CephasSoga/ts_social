export function now() : Date {
    return new Date()
}


export function secsBackward(n: number): Date {
    const time = new Date();
    time.setSeconds(time.getSeconds() - n);
    return time;
}

export function generateRandomString(n: number): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < n; i++) {
      const randomIndex = Math.floor(Math.random() * charset.length);
      result += charset[randomIndex];
    }
    return result;
};


export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

