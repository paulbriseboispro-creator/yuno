import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { 
  Sparkles, 
  Music, 
  Ticket, 
  Wine, 
  Check,
  MapPin,
  Zap,
  Star,
  PartyPopper,
  User,
  Lock,
  Eye,
  EyeOff,
  Globe
} from 'lucide-react';
import yunoLogo from '@/assets/yuno-logo.png';
import { PhoneInputWithCountry } from '@/components/PhoneInputWithCountry';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

type Language = 'en' | 'es' | 'fr';

const maintenanceTranslations: Record<Language, Record<string, string>> = {
  en: {
    launchingSoon: 'Launching soon',
    heroTitle1: 'Your nightlife,',
    heroTitle2: 'simplified.',
    heroDesc: 'Yuno revolutionizes your nights out: tickets, VIP tables, bar orders and loyalty, all in one app.',
    feature1Label: 'Tickets & VIP Tables',
    feature1Desc: 'Book in 2 clicks',
    feature2Label: 'Click & Collect',
    feature2Desc: 'Order at the bar without waiting',
    feature3Label: 'Loyalty',
    feature3Desc: 'Earn rewards',
    feature4Label: 'Exclusive Events',
    feature4Desc: 'The best parties',
    joinVip: 'Join the VIP list',
    beFirst: 'Be among the first to discover Yuno',
    firstName: 'First name *',
    lastName: 'Last name *',
    email: 'Your email *',
    phone: 'Phone',
    city: 'Your city',
    requiredFields: 'First name, last name and email are required',
    joinButton: 'Join the VIP list',
    consent: 'By signing up, you agree to receive emails from Yuno. No spam, we promise 🤝',
    successTitle: "You're on the list! 🎉",
    successDesc: "We'll notify you as soon as Yuno is available. Get ready for your best nights out!",
    priorityAccess: 'Priority access confirmed',
    footer: '© 2025 Yuno. Nightlife experience reinvented.',
    restrictedAccess: 'Restricted access',
    enterPassword: 'Enter the password to access the site',
    password: 'Password',
    cancel: 'Cancel',
    enter: 'Enter',
    alreadyRegistered: 'This email is already registered!',
    welcomeVip: 'Welcome to the VIP list! 🎉',
    errorOccurred: 'An error occurred',
    accessGranted: 'Access granted',
    wrongPassword: 'Wrong password',
    verificationError: 'Error during verification',
  },
  es: {
    launchingSoon: 'Lanzamiento inminente',
    heroTitle1: 'Tu vida nocturna,',
    heroTitle2: 'simplificada.',
    heroDesc: 'Yuno revoluciona tus noches: entradas, mesas VIP, pedidos en el bar y fidelidad, todo en una app.',
    feature1Label: 'Entradas y Mesas VIP',
    feature1Desc: 'Reserva en 2 clics',
    feature2Label: 'Click & Collect',
    feature2Desc: 'Pide en el bar sin esperar',
    feature3Label: 'Fidelidad',
    feature3Desc: 'Gana recompensas',
    feature4Label: 'Eventos Exclusivos',
    feature4Desc: 'Las mejores fiestas',
    joinVip: 'Únete a la lista VIP',
    beFirst: 'Sé de los primeros en descubrir Yuno',
    firstName: 'Nombre *',
    lastName: 'Apellido *',
    email: 'Tu email *',
    phone: 'Teléfono',
    city: 'Tu ciudad',
    requiredFields: 'Nombre, apellido y email son obligatorios',
    joinButton: 'Unirse a la lista VIP',
    consent: 'Al inscribirte, aceptas recibir emails de Yuno. Sin spam, prometido 🤝',
    successTitle: '¡Estás en la lista! 🎉',
    successDesc: 'Te avisaremos cuando Yuno esté disponible. ¡Prepárate para tus mejores noches!',
    priorityAccess: 'Acceso prioritario confirmado',
    footer: '© 2025 Yuno. La experiencia nocturna reinventada.',
    restrictedAccess: 'Acceso restringido',
    enterPassword: 'Introduce la contraseña para acceder al sitio',
    password: 'Contraseña',
    cancel: 'Cancelar',
    enter: 'Entrar',
    alreadyRegistered: '¡Este email ya está registrado!',
    welcomeVip: '¡Bienvenido a la lista VIP! 🎉',
    errorOccurred: 'Ha ocurrido un error',
    accessGranted: 'Acceso autorizado',
    wrongPassword: 'Contraseña incorrecta',
    verificationError: 'Error durante la verificación',
  },
  fr: {
    launchingSoon: 'Lancement imminent',
    heroTitle1: 'Ta vie nocturne,',
    heroTitle2: 'simplifiée.',
    heroDesc: 'Yuno révolutionne tes sorties : billets, tables VIP, commandes au bar et fidélité, le tout dans une seule app.',
    feature1Label: 'Billets & Tables VIP',
    feature1Desc: 'Réserve en 2 clics',
    feature2Label: 'Click & Collect',
    feature2Desc: 'Commande au bar sans file',
    feature3Label: 'Fidélité',
    feature3Desc: 'Gagne des récompenses',
    feature4Label: 'Events exclusifs',
    feature4Desc: 'Les meilleures soirées',
    joinVip: 'Rejoins la liste VIP',
    beFirst: 'Sois parmi les premiers à découvrir Yuno',
    firstName: 'Prénom *',
    lastName: 'Nom *',
    email: 'Ton email *',
    phone: 'Téléphone',
    city: 'Ta ville',
    requiredFields: 'Prénom, nom et email sont obligatoires',
    joinButton: 'Rejoindre la liste VIP',
    consent: 'En t\'inscrivant, tu acceptes de recevoir des emails de Yuno. Pas de spam, promis 🤝',
    successTitle: 'Tu es sur la liste ! 🎉',
    successDesc: 'On te préviendra dès que Yuno sera disponible. Prépare-toi à vivre tes meilleures soirées !',
    priorityAccess: 'Accès prioritaire confirmé',
    footer: '© 2025 Yuno. L\'expérience nightlife réinventée.',
    restrictedAccess: 'Accès restreint',
    enterPassword: 'Entrez le mot de passe pour accéder au site',
    password: 'Mot de passe',
    cancel: 'Annuler',
    enter: 'Entrer',
    alreadyRegistered: 'Cette adresse email est déjà inscrite !',
    welcomeVip: 'Bienvenue dans la liste VIP ! 🎉',
    errorOccurred: 'Une erreur est survenue',
    accessGranted: 'Accès autorisé',
    wrongPassword: 'Mot de passe incorrect',
    verificationError: 'Erreur lors de la vérification',
  },
};

const languages = [
  { code: 'en' as const, name: 'English', flag: '🇬🇧' },
  { code: 'es' as const, name: 'Español', flag: '🇪🇸' },
  { code: 'fr' as const, name: 'Français', flag: '🇫🇷' },
];
export default function Maintenance() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [language, setLanguage] = useState<Language>('fr');
  
  // Password access state
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [checkingPassword, setCheckingPassword] = useState(false);

  const t = (key: string) => maintenanceTranslations[language][key] || key;
  const currentLang = languages.find((l) => l.code === language);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !firstName.trim() || !lastName.trim()) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('launch_waitlist')
        .insert([{ 
          email: email.toLowerCase().trim(),
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          phone: phone.trim() || null,
          city: city.trim() || null
        }]);

      if (error) {
        if (error.code === '23505') {
          toast.error(t('alreadyRegistered'));
        } else {
          throw error;
        }
      } else {
        setSuccess(true);
        toast.success(t('welcomeVip'));
      }
    } catch (error: any) {
      console.error('Error joining waitlist:', error);
      toast.error(t('errorOccurred'));
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;

    setCheckingPassword(true);
    try {
      // Verify password server-side via edge function
      const { data, error } = await supabase.functions.invoke('verify-maintenance-password', {
        body: { password: password.trim() }
      });

      if (error) throw error;

      if (data?.success && data?.bypassToken) {
        // Store secure bypass token in sessionStorage
        sessionStorage.setItem('maintenance_bypass', data.bypassToken);
        sessionStorage.setItem('maintenance_bypass_expires', data.expiresAt);
        toast.success(t('accessGranted'));
        navigate('/');
        window.location.reload();
      } else {
        toast.error(data?.error || t('wrongPassword'));
      }
    } catch (error: any) {
      console.error('Error checking password:', error);
      // Handle rate limiting
      if (error?.message?.includes('429') || error?.status === 429) {
        toast.error('Too many attempts. Please try again later.');
      } else {
        toast.error(t('verificationError'));
      }
    } finally {
      setCheckingPassword(false);
    }
  };

  const features = [
    { icon: Ticket, label: t('feature1Label'), desc: t('feature1Desc') },
    { icon: Wine, label: t('feature2Label'), desc: t('feature2Desc') },
    { icon: Star, label: t('feature3Label'), desc: t('feature3Desc') },
    { icon: Music, label: t('feature4Label'), desc: t('feature4Desc') },
  ];

  return (
    <div
      className="bg-background overflow-hidden relative w-full"
      style={{ minHeight: '100dvh' }}
    >
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute -top-1/4 -right-1/4 w-1/2 h-1/2 rounded-full"
          style={{
            background: 'radial-gradient(circle, hsl(var(--primary) / 0.15) 0%, transparent 70%)',
          }}
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.3, 0.5, 0.3],
          }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute -bottom-1/4 -left-1/4 w-1/2 h-1/2 rounded-full"
          style={{
            background: 'radial-gradient(circle, hsl(var(--primary) / 0.1) 0%, transparent 70%)',
          }}
          animate={{
            scale: [1.2, 1, 1.2],
            opacity: [0.2, 0.4, 0.2],
          }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
        
        {/* Floating particles */}
        {[...Array(20)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-1 h-1 bg-primary/30 rounded-full"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
            }}
            animate={{
              y: [0, -30, 0],
              opacity: [0.2, 0.6, 0.2],
            }}
            transition={{
              duration: 3 + Math.random() * 2,
              repeat: Infinity,
              delay: Math.random() * 2,
            }}
          />
        ))}
      </div>

      <div className="relative z-10 flex flex-col" style={{ minHeight: '100dvh' }}>
        {/* Header */}
        <header
          className="px-4 sm:px-6 lg:px-8 flex items-center justify-between"
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)', paddingBottom: '8px' }}
        >
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3"
          >
            <img src={yunoLogo} alt="Yuno" className="h-10 sm:h-12" />
          </motion.div>
          
          <div className="flex items-center gap-2">
            {/* Language Selector */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <Globe className="h-4 w-4" />
                  <span className="text-lg">{currentLang?.flag}</span>
                  <span className="hidden sm:inline">{currentLang?.name}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-48 p-2">
                <div className="space-y-1">
                  {languages.map((lang) => (
                    <Button
                      key={lang.code}
                      variant={language === lang.code ? 'default' : 'ghost'}
                      className="w-full justify-start gap-2"
                      onClick={() => setLanguage(lang.code)}
                    >
                      <span className="text-lg">{lang.flag}</span>
                      <span>{lang.name}</span>
                    </Button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            
            {/* Discrete password access button */}
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1 }}
              onClick={() => setShowPasswordModal(true)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
            >
              <Lock className="h-3 w-3" />
            </motion.button>
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 flex items-center justify-center px-4 sm:px-6 lg:px-8 py-4 sm:py-8 overflow-y-auto">
          <div className="w-full max-w-5xl mx-auto">
            <div className="grid lg:grid-cols-2 gap-8 lg:gap-16 items-center">
              {/* Left side - Hero */}
              <motion.div
                initial={{ opacity: 0, x: -30 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 }}
                className="text-center lg:text-left"
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.3 }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 mb-6"
                >
                  <Sparkles className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium text-primary">{t('launchingSoon')}</span>
                </motion.div>

                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-6 leading-tight">
                  <span className="text-foreground">{t('heroTitle1')}</span>
                  <br />
                  <span className="text-primary">{t('heroTitle2')}</span>
                </h1>

                <p className="text-lg sm:text-xl text-muted-foreground mb-8 max-w-xl mx-auto lg:mx-0">
                  {t('heroDesc')}
                </p>

                {/* Features grid */}
                <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-8">
                  {features.map((feature, index) => (
                    <motion.div
                      key={feature.label}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.4 + index * 0.1 }}
                      className="flex items-start gap-3 p-3 sm:p-4 rounded-xl bg-surface/50 border border-border/50 backdrop-blur-sm"
                    >
                      <div className="p-2 rounded-lg bg-primary/10">
                        <feature.icon className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                      </div>
                      <div className="text-left">
                        <p className="font-medium text-sm sm:text-base text-foreground">{feature.label}</p>
                        <p className="text-xs sm:text-sm text-muted-foreground">{feature.desc}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>

              {/* Right side - Form */}
              <motion.div
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 }}
                className="relative"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-primary/10 rounded-3xl blur-3xl" />
                
                <div className="relative bg-surface/80 backdrop-blur-xl border border-border/50 rounded-2xl sm:rounded-3xl p-6 sm:p-8 shadow-2xl">
                  <AnimatePresence mode="wait">
                    {!success ? (
                      <motion.div
                        key="form"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                      >
                        <div className="text-center mb-6">
                          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-4">
                            <PartyPopper className="h-7 w-7 text-primary" />
                          </div>
                          <h2 className="text-xl sm:text-2xl font-bold text-foreground mb-2">
                            {t('joinVip')}
                          </h2>
                          <p className="text-muted-foreground text-sm sm:text-base">
                            {t('beFirst')}
                          </p>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-4">
                          <div className="space-y-3">
                            {/* First name and last name BEFORE email */}
                            <div className="grid grid-cols-2 gap-3">
                              <div className="relative">
                                <User className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                  type="text"
                                  placeholder={t('firstName')}
                                  value={firstName}
                                  onChange={(e) => setFirstName(e.target.value)}
                                  required
                                  className="h-12 text-base pl-11 bg-background/50 border-border/50 focus:border-primary"
                                />
                              </div>
                              <div>
                                <Input
                                  type="text"
                                  placeholder={t('lastName')}
                                  value={lastName}
                                  onChange={(e) => setLastName(e.target.value)}
                                  required
                                  className="h-12 text-base bg-background/50 border-border/50 focus:border-primary"
                                />
                              </div>
                            </div>
                            
                            <Input
                              type="email"
                              placeholder={t('email')}
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                              required
                              className="h-12 sm:h-14 text-base sm:text-lg bg-background/50 border-border/50 focus:border-primary"
                            />
                            
                            <PhoneInputWithCountry
                              value={phone}
                              onChange={setPhone}
                              placeholder={t('phone')}
                              className="h-12 text-base bg-background/50 border-border/50 focus:border-primary"
                            />
                            
                            <div className="relative">
                              <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                              <Input
                                type="text"
                                placeholder={t('city')}
                                value={city}
                                onChange={(e) => setCity(e.target.value)}
                                className="h-12 text-base pl-11 bg-background/50 border-border/50 focus:border-primary"
                              />
                            </div>
                            
                            <p className="text-xs text-muted-foreground text-center">
                              {t('requiredFields')}
                            </p>
                            
                            <Button
                              type="submit"
                              disabled={loading || !email || !firstName.trim() || !lastName.trim()}
                              className="w-full h-12 sm:h-14 text-base sm:text-lg font-semibold gap-2"
                            >
                              {loading ? (
                                <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                              ) : (
                                <>
                                  <Zap className="h-5 w-5" />
                                  {t('joinButton')}
                                </>
                              )}
                            </Button>
                          </div>
                        </form>

                        <p className="text-xs text-muted-foreground text-center mt-4">
                          {t('consent')}
                        </p>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="success"
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="text-center py-8"
                      >
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ type: 'spring', delay: 0.2 }}
                          className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary/20 mb-6"
                        >
                          <Check className="h-10 w-10 text-primary" />
                        </motion.div>
                        <h3 className="text-2xl font-bold text-foreground mb-3">
                          {t('successTitle')}
                        </h3>
                        <p className="text-muted-foreground mb-6">
                          {t('successDesc')}
                        </p>
                        <div className="flex items-center justify-center gap-2 text-sm text-primary">
                          <Sparkles className="h-4 w-4" />
                          <span>{t('priorityAccess')}</span>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer
          className="px-4 sm:px-6 lg:px-8 text-center"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)', paddingTop: '8px' }}
        >
          <p className="text-sm text-muted-foreground">
            {t('footer')}
          </p>
        </footer>
      </div>

      {/* Password Modal */}
      <AnimatePresence>
        {showPasswordModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
            onClick={() => setShowPasswordModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm bg-surface border border-border rounded-2xl p-6 shadow-2xl"
            >
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 mb-4">
                  <Lock className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-lg font-bold text-foreground">{t('restrictedAccess')}</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {t('enterPassword')}
                </p>
              </div>

              <form onSubmit={handlePasswordAccess} className="space-y-4">
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    placeholder={t('password')}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-12 pr-12 bg-background/50 border-border/50 focus:border-primary"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>

                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowPasswordModal(false)}
                    className="flex-1 h-11"
                  >
                    {t('cancel')}
                  </Button>
                  <Button
                    type="submit"
                    disabled={checkingPassword || !password.trim()}
                    className="flex-1 h-11"
                  >
                    {checkingPassword ? (
                      <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      t('enter')
                    )}
                  </Button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
