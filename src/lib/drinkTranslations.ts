// Translations for common drink names
// Brand names (Redbull, Coca-Cola, etc.) should NOT be translated

type Language = 'en' | 'es' | 'fr';

interface DrinkTranslations {
  [key: string]: {
    en: string;
    es: string;
    fr: string;
  };
}

// Map of drink names to their translations
// Keys are lowercase for case-insensitive matching
const drinkTranslations: DrinkTranslations = {
  // Water
  'eau': { en: 'Water', es: 'Agua', fr: 'Eau' },
  'water': { en: 'Water', es: 'Agua', fr: 'Eau' },
  'agua': { en: 'Water', es: 'Agua', fr: 'Eau' },
  'eau plate': { en: 'Still Water', es: 'Agua sin gas', fr: 'Eau plate' },
  'still water': { en: 'Still Water', es: 'Agua sin gas', fr: 'Eau plate' },
  'eau gazeuse': { en: 'Sparkling Water', es: 'Agua con gas', fr: 'Eau gazeuse' },
  'sparkling water': { en: 'Sparkling Water', es: 'Agua con gas', fr: 'Eau gazeuse' },
  'eau pétillante': { en: 'Sparkling Water', es: 'Agua con gas', fr: 'Eau pétillante' },
  
  // Juices
  'jus de pomme': { en: 'Apple Juice', es: 'Zumo de manzana', fr: 'Jus de pomme' },
  'apple juice': { en: 'Apple Juice', es: 'Zumo de manzana', fr: 'Jus de pomme' },
  'zumo de manzana': { en: 'Apple Juice', es: 'Zumo de manzana', fr: 'Jus de pomme' },
  'jus d\'orange': { en: 'Orange Juice', es: 'Zumo de naranja', fr: 'Jus d\'orange' },
  'orange juice': { en: 'Orange Juice', es: 'Zumo de naranja', fr: 'Jus d\'orange' },
  'zumo de naranja': { en: 'Orange Juice', es: 'Zumo de naranja', fr: 'Jus d\'orange' },
  'jus de fruits': { en: 'Fruit Juice', es: 'Zumo de frutas', fr: 'Jus de fruits' },
  'fruit juice': { en: 'Fruit Juice', es: 'Zumo de frutas', fr: 'Jus de fruits' },
  'jus de raisin': { en: 'Grape Juice', es: 'Zumo de uva', fr: 'Jus de raisin' },
  'grape juice': { en: 'Grape Juice', es: 'Zumo de uva', fr: 'Jus de raisin' },
  'jus de pamplemousse': { en: 'Grapefruit Juice', es: 'Zumo de pomelo', fr: 'Jus de pamplemousse' },
  'grapefruit juice': { en: 'Grapefruit Juice', es: 'Zumo de pomelo', fr: 'Jus de pamplemousse' },
  'jus de citron': { en: 'Lemon Juice', es: 'Zumo de limón', fr: 'Jus de citron' },
  'lemon juice': { en: 'Lemon Juice', es: 'Zumo de limón', fr: 'Jus de citron' },
  'jus d\'ananas': { en: 'Pineapple Juice', es: 'Zumo de piña', fr: 'Jus d\'ananas' },
  'pineapple juice': { en: 'Pineapple Juice', es: 'Zumo de piña', fr: 'Jus d\'ananas' },
  'jus de mangue': { en: 'Mango Juice', es: 'Zumo de mango', fr: 'Jus de mangue' },
  'mango juice': { en: 'Mango Juice', es: 'Zumo de mango', fr: 'Jus de mangue' },
  'jus de cranberry': { en: 'Cranberry Juice', es: 'Zumo de arándanos', fr: 'Jus de cranberry' },
  'cranberry juice': { en: 'Cranberry Juice', es: 'Zumo de arándanos', fr: 'Jus de cranberry' },
  'jus de tomate': { en: 'Tomato Juice', es: 'Zumo de tomate', fr: 'Jus de tomate' },
  'tomato juice': { en: 'Tomato Juice', es: 'Zumo de tomate', fr: 'Jus de tomate' },
  
  // Sodas/Soft drinks (generic terms)
  'limonade': { en: 'Lemonade', es: 'Limonada', fr: 'Limonade' },
  'lemonade': { en: 'Lemonade', es: 'Limonada', fr: 'Limonade' },
  'limonada': { en: 'Lemonade', es: 'Limonada', fr: 'Limonade' },
  'citron': { en: 'Lemon', es: 'Limón', fr: 'Citron' },
  'lemon': { en: 'Lemon', es: 'Limón', fr: 'Citron' },
  'limón': { en: 'Lemon', es: 'Limón', fr: 'Citron' },
  'orange': { en: 'Orange', es: 'Naranja', fr: 'Orange' },
  'naranja': { en: 'Orange', es: 'Naranja', fr: 'Orange' },
  'fraise': { en: 'Strawberry', es: 'Fresa', fr: 'Fraise' },
  'strawberry': { en: 'Strawberry', es: 'Fresa', fr: 'Fraise' },
  'fresa': { en: 'Strawberry', es: 'Fresa', fr: 'Fraise' },
  'pomme': { en: 'Apple', es: 'Manzana', fr: 'Pomme' },
  'apple': { en: 'Apple', es: 'Manzana', fr: 'Pomme' },
  'manzana': { en: 'Apple', es: 'Manzana', fr: 'Pomme' },
  'thé glacé': { en: 'Iced Tea', es: 'Té helado', fr: 'Thé glacé' },
  'iced tea': { en: 'Iced Tea', es: 'Té helado', fr: 'Thé glacé' },
  'té helado': { en: 'Iced Tea', es: 'Té helado', fr: 'Thé glacé' },
  'soda': { en: 'Soda', es: 'Refresco', fr: 'Soda' },
  'tonic': { en: 'Tonic Water', es: 'Agua tónica', fr: 'Tonic' },
  'tonic water': { en: 'Tonic Water', es: 'Agua tónica', fr: 'Tonic' },
  'eau tonic': { en: 'Tonic Water', es: 'Agua tónica', fr: 'Eau tonic' },
  'ginger ale': { en: 'Ginger Ale', es: 'Ginger Ale', fr: 'Ginger Ale' },
  'ginger beer': { en: 'Ginger Beer', es: 'Cerveza de jengibre', fr: 'Ginger Beer' },
  
  // Hot drinks
  'café': { en: 'Coffee', es: 'Café', fr: 'Café' },
  'coffee': { en: 'Coffee', es: 'Café', fr: 'Café' },
  'thé': { en: 'Tea', es: 'Té', fr: 'Thé' },
  'tea': { en: 'Tea', es: 'Té', fr: 'Thé' },
  'chocolat chaud': { en: 'Hot Chocolate', es: 'Chocolate caliente', fr: 'Chocolat chaud' },
  'hot chocolate': { en: 'Hot Chocolate', es: 'Chocolate caliente', fr: 'Chocolat chaud' },
  
  // Alcoholic - Beers
  'bière': { en: 'Beer', es: 'Cerveza', fr: 'Bière' },
  'beer': { en: 'Beer', es: 'Cerveza', fr: 'Bière' },
  'cerveza': { en: 'Beer', es: 'Cerveza', fr: 'Bière' },
  'bière blonde': { en: 'Lager Beer', es: 'Cerveza rubia', fr: 'Bière blonde' },
  'bière brune': { en: 'Dark Beer', es: 'Cerveza negra', fr: 'Bière brune' },
  'bière blanche': { en: 'Wheat Beer', es: 'Cerveza de trigo', fr: 'Bière blanche' },
  'demi': { en: 'Half Pint', es: 'Caña', fr: 'Demi' },
  'pinte': { en: 'Pint', es: 'Pinta', fr: 'Pinte' },
  'pint': { en: 'Pint', es: 'Pinta', fr: 'Pinte' },
  
  // Alcoholic - Wine
  'vin': { en: 'Wine', es: 'Vino', fr: 'Vin' },
  'wine': { en: 'Wine', es: 'Vino', fr: 'Vin' },
  'vino': { en: 'Wine', es: 'Vino', fr: 'Vin' },
  'vin rouge': { en: 'Red Wine', es: 'Vino tinto', fr: 'Vin rouge' },
  'red wine': { en: 'Red Wine', es: 'Vino tinto', fr: 'Vin rouge' },
  'vino tinto': { en: 'Red Wine', es: 'Vino tinto', fr: 'Vin rouge' },
  'vin blanc': { en: 'White Wine', es: 'Vino blanco', fr: 'Vin blanc' },
  'white wine': { en: 'White Wine', es: 'Vino blanco', fr: 'Vin blanc' },
  'vino blanco': { en: 'White Wine', es: 'Vino blanco', fr: 'Vin blanc' },
  'vin rosé': { en: 'Rosé Wine', es: 'Vino rosado', fr: 'Vin rosé' },
  'rosé': { en: 'Rosé Wine', es: 'Vino rosado', fr: 'Rosé' },
  'rosé wine': { en: 'Rosé Wine', es: 'Vino rosado', fr: 'Vin rosé' },
  'champagne': { en: 'Champagne', es: 'Champán', fr: 'Champagne' },
  'champán': { en: 'Champagne', es: 'Champán', fr: 'Champagne' },
  'crémant': { en: 'Crémant', es: 'Crémant', fr: 'Crémant' },
  'prosecco': { en: 'Prosecco', es: 'Prosecco', fr: 'Prosecco' },
  'cava': { en: 'Cava', es: 'Cava', fr: 'Cava' },
  
  // Alcoholic - Spirits
  'vodka': { en: 'Vodka', es: 'Vodka', fr: 'Vodka' },
  'rhum': { en: 'Rum', es: 'Ron', fr: 'Rhum' },
  'rum': { en: 'Rum', es: 'Ron', fr: 'Rhum' },
  'ron': { en: 'Rum', es: 'Ron', fr: 'Rhum' },
  'whisky': { en: 'Whisky', es: 'Whisky', fr: 'Whisky' },
  'whiskey': { en: 'Whiskey', es: 'Whiskey', fr: 'Whiskey' },
  'gin': { en: 'Gin', es: 'Ginebra', fr: 'Gin' },
  'ginebra': { en: 'Gin', es: 'Ginebra', fr: 'Gin' },
  'tequila': { en: 'Tequila', es: 'Tequila', fr: 'Tequila' },
  'cognac': { en: 'Cognac', es: 'Coñac', fr: 'Cognac' },
  'coñac': { en: 'Cognac', es: 'Coñac', fr: 'Cognac' },
  
  // Cocktails
  'mojito': { en: 'Mojito', es: 'Mojito', fr: 'Mojito' },
  'margarita': { en: 'Margarita', es: 'Margarita', fr: 'Margarita' },
  'piña colada': { en: 'Piña Colada', es: 'Piña Colada', fr: 'Piña Colada' },
  'cuba libre': { en: 'Cuba Libre', es: 'Cuba Libre', fr: 'Cuba Libre' },
  'gin tonic': { en: 'Gin & Tonic', es: 'Gin Tonic', fr: 'Gin Tonic' },
  'gin & tonic': { en: 'Gin & Tonic', es: 'Gin Tonic', fr: 'Gin Tonic' },
  'long island': { en: 'Long Island Iced Tea', es: 'Long Island', fr: 'Long Island' },
  'long island iced tea': { en: 'Long Island Iced Tea', es: 'Long Island', fr: 'Long Island' },
  'cosmopolitan': { en: 'Cosmopolitan', es: 'Cosmopolitan', fr: 'Cosmopolitan' },
  'sex on the beach': { en: 'Sex on the Beach', es: 'Sex on the Beach', fr: 'Sex on the Beach' },
  'moscow mule': { en: 'Moscow Mule', es: 'Moscow Mule', fr: 'Moscow Mule' },
  'bloody mary': { en: 'Bloody Mary', es: 'Bloody Mary', fr: 'Bloody Mary' },
  'caipirinha': { en: 'Caipirinha', es: 'Caipirinha', fr: 'Caipirinha' },
  'daiquiri': { en: 'Daiquiri', es: 'Daiquiri', fr: 'Daiquiri' },
  'martini': { en: 'Martini', es: 'Martini', fr: 'Martini' },
  'negroni': { en: 'Negroni', es: 'Negroni', fr: 'Negroni' },
  'spritz': { en: 'Spritz', es: 'Spritz', fr: 'Spritz' },
  'aperol spritz': { en: 'Aperol Spritz', es: 'Aperol Spritz', fr: 'Aperol Spritz' },
  
  // Shots
  'shot': { en: 'Shot', es: 'Chupito', fr: 'Shot' },
  'chupito': { en: 'Shot', es: 'Chupito', fr: 'Shot' },
  'shooter': { en: 'Shooter', es: 'Chupito', fr: 'Shooter' },
  'tequila shot': { en: 'Tequila Shot', es: 'Chupito de tequila', fr: 'Shot de tequila' },
  'shot de tequila': { en: 'Tequila Shot', es: 'Chupito de tequila', fr: 'Shot de tequila' },
  'vodka shot': { en: 'Vodka Shot', es: 'Chupito de vodka', fr: 'Shot de vodka' },
  'shot de vodka': { en: 'Vodka Shot', es: 'Chupito de vodka', fr: 'Shot de vodka' },
  
  // Other
  'sirop': { en: 'Syrup', es: 'Sirope', fr: 'Sirop' },
  'syrup': { en: 'Syrup', es: 'Sirope', fr: 'Sirop' },
  'sirope': { en: 'Syrup', es: 'Sirope', fr: 'Sirop' },
  'menthe': { en: 'Mint', es: 'Menta', fr: 'Menthe' },
  'mint': { en: 'Mint', es: 'Menta', fr: 'Menthe' },
  'grenadine': { en: 'Grenadine', es: 'Granadina', fr: 'Grenadine' },
  'virgin': { en: 'Virgin', es: 'Sin alcohol', fr: 'Virgin' },
  'sans alcool': { en: 'Alcohol-free', es: 'Sin alcohol', fr: 'Sans alcool' },
  'alcohol-free': { en: 'Alcohol-free', es: 'Sin alcohol', fr: 'Sans alcool' },
  'sin alcohol': { en: 'Alcohol-free', es: 'Sin alcohol', fr: 'Sans alcool' },
};

/**
 * Translates a drink name if a translation exists.
 * Brand names and unknown drinks are returned unchanged.
 * 
 * @param name - The drink name to translate
 * @param language - Target language ('en', 'es', or 'fr')
 * @returns Translated name or original name if no translation exists
 */
export function translateDrinkName(name: string, language: Language): string {
  if (!name) return name;
  
  const lowerName = name.toLowerCase().trim();
  const translation = drinkTranslations[lowerName];
  
  if (translation) {
    return translation[language];
  }
  
  // No translation found - return original (probably a brand name)
  return name;
}

/**
 * Translates parts of a compound drink name (e.g., "Fanta Citron" -> "Fanta Lemon")
 * Brand names are kept unchanged, only generic parts are translated
 */
export function translateCompoundDrinkName(name: string, language: Language): string {
  if (!name) return name;
  
  // First, try to find multi-word phrases to translate
  let result = name;
  
  // Sort translations by key length (longest first) to match longer phrases first
  const sortedKeys = Object.keys(drinkTranslations).sort((a, b) => b.length - a.length);
  
  for (const key of sortedKeys) {
    // Create a case-insensitive regex to find and replace the phrase
    const regex = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    if (regex.test(result)) {
      const translation = drinkTranslations[key][language];
      result = result.replace(regex, (match) => {
        // Preserve original capitalization
        if (match[0] === match[0].toUpperCase()) {
          return translation.charAt(0).toUpperCase() + translation.slice(1);
        }
        return translation.toLowerCase();
      });
    }
  }
  
  return result;
}

/**
 * Hook-compatible function that uses the current language context
 * First tries exact match, then tries compound translation
 */
export function getTranslatedDrinkName(name: string, currentLanguage: string): string {
  const lang = (currentLanguage === 'en' || currentLanguage === 'es' || currentLanguage === 'fr') 
    ? currentLanguage 
    : 'en';
  
  // First try exact match
  const exactTranslation = translateDrinkName(name, lang as Language);
  if (exactTranslation !== name) {
    return exactTranslation;
  }
  
  // Then try compound translation (word by word)
  return translateCompoundDrinkName(name, lang as Language);
}
