import { useState, useEffect } from 'react';

export type WalletType = 'apple' | 'google' | 'none';

export function useWalletDetection(): {
  walletType: WalletType;
  isAppleDevice: boolean;
  isAndroidDevice: boolean;
  canAddToWallet: boolean;
} {
  const [walletType, setWalletType] = useState<WalletType>('none');
  const [isAppleDevice, setIsAppleDevice] = useState(false);
  const [isAndroidDevice, setIsAndroidDevice] = useState(false);

  useEffect(() => {
    const userAgent = navigator.userAgent.toLowerCase();
    const platform = navigator.platform?.toLowerCase() || '';
    
    // Detect iOS devices (iPhone, iPad, iPod)
    const isIOS = /iphone|ipad|ipod/.test(userAgent) || 
      (platform === 'macintel' && navigator.maxTouchPoints > 1); // iPad Pro detection
    
    // Detect macOS Safari (also supports Apple Wallet)
    const isMacSafari = /macintosh/.test(userAgent) && /safari/.test(userAgent) && !/chrome/.test(userAgent);
    
    // Detect Android devices
    const isAndroid = /android/.test(userAgent);
    
    setIsAppleDevice(isIOS || isMacSafari);
    setIsAndroidDevice(isAndroid);
    
    if (isIOS || isMacSafari) {
      setWalletType('apple');
    } else if (isAndroid) {
      setWalletType('google');
    } else {
      // Desktop or other - show Google Wallet as it works via web link
      setWalletType('google');
    }
  }, []);

  return {
    walletType,
    isAppleDevice,
    isAndroidDevice,
    canAddToWallet: walletType !== 'none',
  };
}
