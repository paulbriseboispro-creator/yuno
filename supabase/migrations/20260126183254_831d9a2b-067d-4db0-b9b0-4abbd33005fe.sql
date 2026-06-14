-- Add ticket_type column to ticket_rounds table
ALTER TABLE ticket_rounds 
ADD COLUMN ticket_type text NOT NULL DEFAULT 'standard';

-- Add ticket_type column to tickets table
ALTER TABLE tickets 
ADD COLUMN ticket_type text NOT NULL DEFAULT 'standard';

-- Create indexes for efficient queries
CREATE INDEX idx_ticket_rounds_type ON ticket_rounds(ticket_type);
CREATE INDEX idx_tickets_type ON tickets(ticket_type);