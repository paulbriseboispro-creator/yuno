-- Déclaration sur l'honneur de majorité (honor-system age declaration).
--
-- L'âge réel ne peut pas être vérifié en ligne. L'acheteur certifie sur l'honneur
-- avoir 18 ans ou plus, et l'ÉTABLISSEMENT effectue le vrai contrôle de la pièce
-- d'identité à l'entrée. Pour que cette déclaration soit exploitable, on l'ENREGISTRE
-- côté serveur au moment de l'achat (horodatage + date de naissance auto-déclarée + IP),
-- afin qu'elle ne soit pas contournable par un appel API direct et qu'il existe une
-- trace auditable. Ce n'est PAS du KYC : minimisation RGPD, on ne stocke que la preuve
-- de déclaration.

alter table public.orders
  add column if not exists age_declared_at timestamptz,
  add column if not exists age_declaration_birth_date date,
  add column if not exists age_declaration_ip text;

alter table public.table_reservations
  add column if not exists age_declared_at timestamptz,
  add column if not exists age_declaration_birth_date date,
  add column if not exists age_declaration_ip text;

comment on column public.orders.age_declared_at is
  'Déclaration sur l''honneur 18+ à l''achat. Le contrôle réel de la pièce d''identité est fait par l''établissement à l''entrée.';
comment on column public.table_reservations.age_declared_at is
  'Déclaration sur l''honneur 18+ à l''achat. Le contrôle réel de la pièce d''identité est fait par l''établissement à l''entrée.';
