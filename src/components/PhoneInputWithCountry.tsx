import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { COUNTRIES, countryFromPhone, formatNationalNumber, type Country } from '@/lib/countries';
import { useLanguage } from '@/contexts/LanguageContext';

// La liste des pays est celle de `@/lib/countries` — une seule source, sinon
// les deux copies divergent (elles l'avaient déjà fait sur le nom français de
// l'Arabie saoudite) et l'outre-mer manquerait ici tout en existant sur la
// carte des origines.
const countries = COUNTRIES;

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
    
    // Même résolution que la carte des origines : le préfixe le PLUS LONG
    // gagne, donc un numéro de Porto Rico ne s'affiche pas en drapeau
    // américain. On retire l'indicatif court, c'est lui que montre le sélecteur.
    const match = countryFromPhone(phone);
    if (match && phone.startsWith(match.dialCode)) {
      return { country: match, number: phone.slice(match.dialCode.length).trim() };
    }
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
    // Re-group the existing digits under the newly selected country's format.
    onChange(`${country.dialCode} ${formatNationalNumber(phoneNumber, country)}`);
    setIsOpen(false);
  };

  const handleNumberChange = (newNumber: string) => {
    // Strip the national trunk "0" / mistyped dial code and pretty-group.
    const formatted = formatNationalNumber(newNumber, selectedCountry);
    onChange(`${selectedCountry.dialCode} ${formatted}`);
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
