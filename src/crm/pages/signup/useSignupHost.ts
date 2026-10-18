/**
 * Le nom que le fan lit sur une page d'inscription : voir signupHostName
 * (signupLogic.ts), miroir de crm_space_display_name.
 */
import { useCrmScope } from '@/crm/scope';
import { useEmailSettings } from '@/crm/data/emails';
import { signupHostName } from './signupLogic';

export function useSignupHost(): string {
  const { space } = useCrmScope();
  const { data } = useEmailSettings();
  return signupHostName(space.name, data?.sender_name);
}
