-- Ajouter ticket_type aux presets de tickets
ALTER TABLE ticket_presets 
ADD COLUMN ticket_type text NOT NULL DEFAULT 'standard';

-- Index pour requêtes performantes
CREATE INDEX idx_ticket_presets_type ON ticket_presets(ticket_type);