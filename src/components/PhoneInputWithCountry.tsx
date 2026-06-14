import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';

interface Country {
  code: string;
  dialCode: string;
  flag: string;
  format: string; // Placeholder format for the phone number
  names: {
    en: string;
    es: string;
    fr: string;
  };
}

const countries: Country[] = [
  { code: 'FR', dialCode: '+33', flag: '🇫🇷', format: '6 12 34 56 78', names: { en: 'France', es: 'Francia', fr: 'France' } },
  { code: 'ES', dialCode: '+34', flag: '🇪🇸', format: '612 34 56 78', names: { en: 'Spain', es: 'España', fr: 'Espagne' } },
  { code: 'GB', dialCode: '+44', flag: '🇬🇧', format: '7911 123456', names: { en: 'United Kingdom', es: 'Reino Unido', fr: 'Royaume-Uni' } },
  { code: 'DE', dialCode: '+49', flag: '🇩🇪', format: '151 12345678', names: { en: 'Germany', es: 'Alemania', fr: 'Allemagne' } },
  { code: 'IT', dialCode: '+39', flag: '🇮🇹', format: '312 345 6789', names: { en: 'Italy', es: 'Italia', fr: 'Italie' } },
  { code: 'PT', dialCode: '+351', flag: '🇵🇹', format: '912 345 678', names: { en: 'Portugal', es: 'Portugal', fr: 'Portugal' } },
  { code: 'BE', dialCode: '+32', flag: '🇧🇪', format: '470 12 34 56', names: { en: 'Belgium', es: 'Bélgica', fr: 'Belgique' } },
  { code: 'NL', dialCode: '+31', flag: '🇳🇱', format: '6 12345678', names: { en: 'Netherlands', es: 'Países Bajos', fr: 'Pays-Bas' } },
  { code: 'CH', dialCode: '+41', flag: '🇨🇭', format: '76 123 45 67', names: { en: 'Switzerland', es: 'Suiza', fr: 'Suisse' } },
  { code: 'LU', dialCode: '+352', flag: '🇱🇺', format: '621 123 456', names: { en: 'Luxembourg', es: 'Luxemburgo', fr: 'Luxembourg' } },
  { code: 'MC', dialCode: '+377', flag: '🇲🇨', format: '6 12 34 56 78', names: { en: 'Monaco', es: 'Mónaco', fr: 'Monaco' } },
  { code: 'AT', dialCode: '+43', flag: '🇦🇹', format: '664 1234567', names: { en: 'Austria', es: 'Austria', fr: 'Autriche' } },
  { code: 'PL', dialCode: '+48', flag: '🇵🇱', format: '512 345 678', names: { en: 'Poland', es: 'Polonia', fr: 'Pologne' } },
  { code: 'IE', dialCode: '+353', flag: '🇮🇪', format: '85 123 4567', names: { en: 'Ireland', es: 'Irlanda', fr: 'Irlande' } },
  { code: 'SE', dialCode: '+46', flag: '🇸🇪', format: '70 123 45 67', names: { en: 'Sweden', es: 'Suecia', fr: 'Suède' } },
  { code: 'NO', dialCode: '+47', flag: '🇳🇴', format: '412 34 567', names: { en: 'Norway', es: 'Noruega', fr: 'Norvège' } },
  { code: 'DK', dialCode: '+45', flag: '🇩🇰', format: '20 12 34 56', names: { en: 'Denmark', es: 'Dinamarca', fr: 'Danemark' } },
  { code: 'FI', dialCode: '+358', flag: '🇫🇮', format: '40 1234567', names: { en: 'Finland', es: 'Finlandia', fr: 'Finlande' } },
  { code: 'GR', dialCode: '+30', flag: '🇬🇷', format: '691 234 5678', names: { en: 'Greece', es: 'Grecia', fr: 'Grèce' } },
  { code: 'CZ', dialCode: '+420', flag: '🇨🇿', format: '601 234 567', names: { en: 'Czech Republic', es: 'República Checa', fr: 'République tchèque' } },
  { code: 'RO', dialCode: '+40', flag: '🇷🇴', format: '712 345 678', names: { en: 'Romania', es: 'Rumania', fr: 'Roumanie' } },
  { code: 'HU', dialCode: '+36', flag: '🇭🇺', format: '20 123 4567', names: { en: 'Hungary', es: 'Hungría', fr: 'Hongrie' } },
  { code: 'US', dialCode: '+1', flag: '🇺🇸', format: '(201) 555-0123', names: { en: 'United States', es: 'Estados Unidos', fr: 'États-Unis' } },
  { code: 'CA', dialCode: '+1', flag: '🇨🇦', format: '(204) 555-0123', names: { en: 'Canada', es: 'Canadá', fr: 'Canada' } },
  { code: 'MA', dialCode: '+212', flag: '🇲🇦', format: '6 12 34 56 78', names: { en: 'Morocco', es: 'Marruecos', fr: 'Maroc' } },
  { code: 'DZ', dialCode: '+213', flag: '🇩🇿', format: '551 23 45 67', names: { en: 'Algeria', es: 'Argelia', fr: 'Algérie' } },
  { code: 'TN', dialCode: '+216', flag: '🇹🇳', format: '20 123 456', names: { en: 'Tunisia', es: 'Túnez', fr: 'Tunisie' } },
  { code: 'BR', dialCode: '+55', flag: '🇧🇷', format: '11 91234-5678', names: { en: 'Brazil', es: 'Brasil', fr: 'Brésil' } },
  { code: 'MX', dialCode: '+52', flag: '🇲🇽', format: '55 1234 5678', names: { en: 'Mexico', es: 'México', fr: 'Mexique' } },
  { code: 'AR', dialCode: '+54', flag: '🇦🇷', format: '11 1234-5678', names: { en: 'Argentina', es: 'Argentina', fr: 'Argentine' } },
  { code: 'CO', dialCode: '+57', flag: '🇨🇴', format: '310 1234567', names: { en: 'Colombia', es: 'Colombia', fr: 'Colombie' } },
  { code: 'JP', dialCode: '+81', flag: '🇯🇵', format: '90 1234 5678', names: { en: 'Japan', es: 'Japón', fr: 'Japon' } },
  { code: 'CN', dialCode: '+86', flag: '🇨🇳', format: '131 2345 6789', names: { en: 'China', es: 'China', fr: 'Chine' } },
  { code: 'IN', dialCode: '+91', flag: '🇮🇳', format: '91234 56789', names: { en: 'India', es: 'India', fr: 'Inde' } },
  { code: 'AU', dialCode: '+61', flag: '🇦🇺', format: '412 345 678', names: { en: 'Australia', es: 'Australia', fr: 'Australie' } },
  { code: 'RU', dialCode: '+7', flag: '🇷🇺', format: '912 345-67-89', names: { en: 'Russia', es: 'Rusia', fr: 'Russie' } },
  { code: 'TR', dialCode: '+90', flag: '🇹🇷', format: '532 123 45 67', names: { en: 'Turkey', es: 'Turquía', fr: 'Turquie' } },
  { code: 'AE', dialCode: '+971', flag: '🇦🇪', format: '50 123 4567', names: { en: 'United Arab Emirates', es: 'Emiratos Árabes Unidos', fr: 'Émirats arabes unis' } },
  { code: 'SA', dialCode: '+966', flag: '🇸🇦', format: '50 123 4567', names: { en: 'Saudi Arabia', es: 'Arabia Saudita', fr: 'Arabie saoudite' } },
];

interface PhoneInputWithCountryProps {
  value: string;
  onChange: (fullPhone: string) => void;
  id?: string;
  placeholder?: string;
  className?: string;
}

export function PhoneInputWithCountry({ 
  value, 
  onChange, 
  id, 
  placeholder = '6 12 34 56 78',
  className 
}: PhoneInputWithCountryProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { language } = useLanguage();
  
  const getCountryName = (country: Country) => {
    return country.names[language as keyof typeof country.names] || country.names.en;
  };
  
  // Parse the value to extract country code and number
  const parsePhoneValue = (phone: string): { country: Country; number: string } => {
    if (!phone) {
      return { country: countries[0], number: '' };
    }
    
    // Try to find matching country by dial code
    for (const country of countries) {
      if (phone.startsWith(country.dialCode)) {
        return { 
          country, 
          number: phone.slice(country.dialCode.length).trim() 
        };
      }
    }
    
    // Default to France if no match
    return { country: countries[0], number: phone.replace(/^\+\d+\s*/, '') };
  };
  
  const { country: selectedCountry, number: phoneNumber } = parsePhoneValue(value);
  
  const handleCountrySelect = (country: Country) => {
    onChange(`${country.dialCode} ${phoneNumber}`);
    setIsOpen(false);
  };
  
  const handleNumberChange = (newNumber: string) => {
    // Remove any non-digit characters except spaces
    const cleaned = newNumber.replace(/[^\d\s]/g, '');
    onChange(`${selectedCountry.dialCode} ${cleaned}`);
  };
  
  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  return (
    <div className={cn("flex gap-2", className)}>
      {/* Country selector */}
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1.5 h-11 px-3 rounded-lg bg-[#1F1F22] border border-white/[0.08] hover:border-white/[0.16] transition-colors min-w-[100px]"
        >
          <span className="text-lg">{selectedCountry.flag}</span>
          <span className="text-sm text-white">{selectedCountry.dialCode}</span>
          <ChevronDown className={cn(
            "h-3.5 w-3.5 text-[#5A5A5E] transition-transform",
            isOpen && "rotate-180"
          )} />
        </button>
        
        {isOpen && (
          <div className="absolute top-full left-0 mt-1 w-64 max-h-60 overflow-y-auto rounded-lg border border-white/[0.10] bg-[#141414] shadow-[0_16px_40px_rgba(0,0,0,0.5)] z-50">
            {countries.map((country) => (
              <button
                key={country.code}
                type="button"
                onClick={() => handleCountrySelect(country)}
                className={cn(
                  "flex items-center gap-3 w-full px-3 py-2 text-left hover:bg-white/[0.04] transition-colors",
                  selectedCountry.code === country.code && "bg-primary/10"
                )}
              >
                <span className="text-lg">{country.flag}</span>
                <span className="text-sm flex-1 truncate text-[#E5E5E5]">{getCountryName(country)}</span>
                <span className="text-xs text-[#5A5A5E]">{country.dialCode}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      
      {/* Phone number input */}
      <Input
        id={id}
        type="tel"
        placeholder={selectedCountry.format}
        value={phoneNumber}
        onChange={(e) => handleNumberChange(e.target.value)}
        className="flex-1 h-11 rounded-lg bg-[#1F1F22] border-white/[0.08] text-white placeholder:text-[#5A5A5E] focus-visible:ring-0 focus-visible:border-primary/50"
      />
    </div>
  );
}
