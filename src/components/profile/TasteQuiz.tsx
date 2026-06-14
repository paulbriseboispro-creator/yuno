import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Sparkles, Music, Wine, Users, Moon, PartyPopper, ChevronRight, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TasteQuizProps {
  userId: string;
  onComplete: () => void;
}

interface QuizQuestion {
  id: string;
  icon: React.ReactNode;
  titleKey: string;
  multiSelect: boolean;
  maxSelect?: number;
  options: { value: string; emoji: string; labelKey: string }[];
}

const questions: QuizQuestion[] = [
  {
    id: 'music_style',
    icon: <Music className="h-6 w-6" />,
    titleKey: 'quiz.musicQuestion',
    multiSelect: true,
    maxSelect: 3,
    options: [
      { value: 'techno', emoji: '🎧', labelKey: 'quiz.techno' },
      { value: 'house', emoji: '🏠', labelKey: 'quiz.house' },
      { value: 'edm', emoji: '⚡', labelKey: 'quiz.edm' },
      { value: 'trance', emoji: '🌀', labelKey: 'quiz.trance' },
      { value: 'hiphop', emoji: '🎤', labelKey: 'quiz.hiphop' },
      { value: 'rnb', emoji: '💜', labelKey: 'quiz.rnb' },
      { value: 'trap', emoji: '🔥', labelKey: 'quiz.trap' },
      { value: 'reggaeton', emoji: '💃', labelKey: 'quiz.reggaeton' },
      { value: 'salsa', emoji: '🌶️', labelKey: 'quiz.salsa' },
      { value: 'afrobeats', emoji: '🌍', labelKey: 'quiz.afrobeats' },
      { value: 'pop', emoji: '🎵', labelKey: 'quiz.pop' },
      { value: 'rock', emoji: '🎸', labelKey: 'quiz.rock' },
      { value: 'disco', emoji: '🪩', labelKey: 'quiz.disco' },
      { value: 'jazz', emoji: '🎷', labelKey: 'quiz.jazz' },
      { value: 'everything', emoji: '🎶', labelKey: 'quiz.everything' },
    ],
  },
  {
    id: 'drink_preference',
    icon: <Wine className="h-6 w-6" />,
    titleKey: 'quiz.drinkQuestion',
    multiSelect: true,
    maxSelect: 3,
    options: [
      { value: 'cocktails', emoji: '🍸', labelKey: 'quiz.cocktails' },
      { value: 'shots', emoji: '🥃', labelKey: 'quiz.shots' },
      { value: 'champagne', emoji: '🍾', labelKey: 'quiz.champagne' },
      { value: 'beer', emoji: '🍺', labelKey: 'quiz.beer' },
      { value: 'wine', emoji: '🍷', labelKey: 'quiz.wine' },
      { value: 'vodka', emoji: '🧊', labelKey: 'quiz.vodka' },
      { value: 'whiskey', emoji: '🥃', labelKey: 'quiz.whiskey' },
      { value: 'gin', emoji: '🫒', labelKey: 'quiz.gin' },
      { value: 'tequila', emoji: '🌵', labelKey: 'quiz.tequila' },
      { value: 'rum', emoji: '🏝️', labelKey: 'quiz.rum' },
      { value: 'mocktails', emoji: '🧃', labelKey: 'quiz.mocktails' },
      { value: 'energy', emoji: '⚡', labelKey: 'quiz.energy' },
    ],
  },
  {
    id: 'vibe_preference',
    icon: <Sparkles className="h-6 w-6" />,
    titleKey: 'quiz.vibeQuestion',
    multiSelect: true,
    maxSelect: 2,
    options: [
      { value: 'chill', emoji: '😌', labelKey: 'quiz.chill' },
      { value: 'party', emoji: '🔥', labelKey: 'quiz.party' },
      { value: 'exclusive', emoji: '💎', labelKey: 'quiz.exclusive' },
      { value: 'wild', emoji: '🤪', labelKey: 'quiz.wild' },
      { value: 'romantic', emoji: '💕', labelKey: 'quiz.romantic' },
      { value: 'underground', emoji: '🖤', labelKey: 'quiz.underground' },
      { value: 'rooftop', emoji: '🌃', labelKey: 'quiz.rooftop' },
      { value: 'beach', emoji: '🏖️', labelKey: 'quiz.beach' },
    ],
  },
  {
    id: 'crowd_size',
    icon: <Users className="h-6 w-6" />,
    titleKey: 'quiz.crowdQuestion',
    multiSelect: false,
    options: [
      { value: 'intimate', emoji: '🫂', labelKey: 'quiz.intimate' },
      { value: 'medium', emoji: '👥', labelKey: 'quiz.medium' },
      { value: 'big', emoji: '🎉', labelKey: 'quiz.big' },
      { value: 'massive', emoji: '🏟️', labelKey: 'quiz.massive' },
      { value: 'festival', emoji: '🎪', labelKey: 'quiz.festival' },
    ],
  },
  {
    id: 'night_type',
    icon: <Moon className="h-6 w-6" />,
    titleKey: 'quiz.nightQuestion',
    multiSelect: true,
    maxSelect: 2,
    options: [
      { value: 'afterwork', emoji: '🌆', labelKey: 'quiz.afterwork' },
      { value: 'dinner_party', emoji: '🍽️', labelKey: 'quiz.dinnerParty' },
      { value: 'pregame', emoji: '🥂', labelKey: 'quiz.pregame' },
      { value: 'club_night', emoji: '🪩', labelKey: 'quiz.clubNight' },
      { value: 'all_night', emoji: '🌙', labelKey: 'quiz.allNight' },
      { value: 'sunrise', emoji: '🌅', labelKey: 'quiz.sunrise' },
      { value: 'weekend_warrior', emoji: '💪', labelKey: 'quiz.weekendWarrior' },
    ],
  },
];

export function TasteQuiz({ userId, onComplete }: TasteQuizProps) {
  const { t } = useLanguage();
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const currentQuestion = questions[currentStep];
  const progress = ((currentStep + 1) / questions.length) * 100;
  const currentSelections = answers[currentQuestion.id] || [];

  const handleSelect = (value: string) => {
    if (currentQuestion.multiSelect) {
      // Multi-select logic
      const current = answers[currentQuestion.id] || [];
      const maxSelect = currentQuestion.maxSelect || 3;
      
      if (current.includes(value)) {
        // Deselect
        setAnswers({ ...answers, [currentQuestion.id]: current.filter(v => v !== value) });
      } else if (current.length < maxSelect) {
        // Select
        setAnswers({ ...answers, [currentQuestion.id]: [...current, value] });
      }
    } else {
      // Single select - auto advance
      const newAnswers = { ...answers, [currentQuestion.id]: [value] };
      setAnswers(newAnswers);
      
      if (currentStep < questions.length - 1) {
        setTimeout(() => setCurrentStep(currentStep + 1), 300);
      } else {
        submitQuiz(newAnswers);
      }
    }
  };

  const handleNext = async () => {
    if (currentSelections.length === 0) return;
    
    if (currentStep < questions.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      submitQuiz(answers);
    }
  };

  const submitQuiz = async (finalAnswers: Record<string, string[]>) => {
    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('user_taste_profiles')
        .upsert({
          user_id: userId,
          music_style: finalAnswers.music_style?.join(',') || '',
          drink_preference: finalAnswers.drink_preference?.join(',') || '',
          vibe_preference: finalAnswers.vibe_preference?.join(',') || '',
          crowd_size: finalAnswers.crowd_size?.[0] || '',
          night_type: finalAnswers.night_type?.join(',') || '',
        }, { onConflict: 'user_id' });

      if (error) throw error;
      
      toast.success(t('quiz.completed'));
      onComplete();
    } catch (error) {
      console.error('Error saving quiz:', error);
      toast.error(t('quiz.error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const canProceed = currentSelections.length > 0;

  return (
    <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 via-background to-accent/5">
      <CardContent className="p-0">
        {/* Progress bar */}
        <div className="h-1 bg-muted">
          <motion.div
            className="h-full bg-gradient-to-r from-primary to-accent"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>

        <div className="p-5">
          {/* Header */}
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 text-primary">
              <PartyPopper className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-foreground">{t('quiz.title')}</h3>
              <p className="text-xs text-muted-foreground">
                {t('quiz.step').replace('{current}', String(currentStep + 1)).replace('{total}', String(questions.length))}
              </p>
            </div>
            {currentQuestion.multiSelect && (
              <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary font-medium">
                {currentSelections.length}/{currentQuestion.maxSelect}
              </span>
            )}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              {/* Question */}
              <div className="flex items-center gap-2 mb-2">
                <span className="text-primary">{currentQuestion.icon}</span>
                <h4 className="text-lg font-medium text-foreground">
                  {t(currentQuestion.titleKey)}
                </h4>
              </div>
              
              {currentQuestion.multiSelect && (
                <p className="text-xs text-muted-foreground mb-4">
                  {t('quiz.selectMultiple').replace('{max}', String(currentQuestion.maxSelect))}
                </p>
              )}

              {/* Options - scrollable grid */}
              <div className="max-h-[280px] overflow-y-auto pr-1 -mr-1">
                <div className="grid grid-cols-3 gap-2">
                  {currentQuestion.options.map((option) => {
                    const isSelected = currentSelections.includes(option.value);
                    return (
                      <motion.button
                        key={option.value}
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => handleSelect(option.value)}
                        disabled={isSubmitting}
                        className={cn(
                          "relative p-3 rounded-xl border-2 text-center transition-all",
                          isSelected
                            ? 'border-primary bg-primary/10 shadow-md'
                            : 'border-border/50 bg-card/50 hover:border-primary/50 hover:bg-card'
                        )}
                      >
                        {isSelected && (
                          <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            className="absolute top-1 right-1 p-0.5 rounded-full bg-primary text-primary-foreground"
                          >
                            <Check className="h-2.5 w-2.5" />
                          </motion.div>
                        )}
                        <span className="text-xl block mb-0.5">{option.emoji}</span>
                        <span className="text-xs font-medium text-foreground leading-tight block">
                          {t(option.labelKey)}
                        </span>
                      </motion.button>
                    );
                  })}
                </div>
              </div>

              {/* Next button for multi-select */}
              {currentQuestion.multiSelect && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-4"
                >
                  <Button
                    onClick={handleNext}
                    disabled={!canProceed || isSubmitting}
                    className="w-full gap-2"
                  >
                    {currentStep === questions.length - 1 ? (
                      <>
                        <Sparkles className="h-4 w-4" />
                        {t('quiz.finish')}
                      </>
                    ) : (
                      <>
                        {t('quiz.next')}
                        <ChevronRight className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                </motion.div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Navigation dots */}
          <div className="flex justify-center gap-1.5 mt-4">
            {questions.map((_, idx) => (
              <div
                key={idx}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  idx === currentStep
                    ? 'w-6 bg-primary'
                    : idx < currentStep
                    ? 'w-1.5 bg-primary/50'
                    : 'w-1.5 bg-muted'
                )}
              />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
