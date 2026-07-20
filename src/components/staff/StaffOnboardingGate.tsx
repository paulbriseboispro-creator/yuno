/**
 * Redirige un compte staff terrain jamais onboardé vers /staff/welcome.
 *
 * Remplace RoleIntroGate sur les quatre dashboards staff : le flag vit en base
 * (profiles.staff_onboarded_at), donc une intro par PERSONNE, pas par appareil.
 * Les comptes existants sont backfillés côté migration — personne ne se prend
 * un wizard en plein service.
 */

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStaffIdentity } from '@/hooks/useStaffIdentity';

const FIELD_ROLES = ['bouncer', 'barman', 'cloakroom', 'vip_host'];

export function StaffOnboardingGate() {
  const navigate = useNavigate();
  const { identity, loading } = useStaffIdentity();

  useEffect(() => {
    if (loading || !identity) return;
    if (identity.staffOnboardedAt) return;
    if (!identity.role || !FIELD_ROLES.includes(identity.role)) return;
    navigate('/staff/welcome', { replace: true });
  }, [loading, identity, navigate]);

  return null;
}
