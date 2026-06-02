/*
  # Përditëso modelin e Anthropic në një model aktual

  Modeli fillestar `claude-3-5-sonnet-20241022` është i vjetër/i tërhequr dhe shkaktonte
  dështim të analizës. E vendosim te Opus i fundit. Admini mund ta ndryshojë nga UI
  (Admin → AI Providers → fusha "Modeli AI").
*/

UPDATE ai_providers
SET model = 'claude-opus-4-8', updated_at = now()
WHERE slug = 'anthropic' AND (model IS NULL OR model = '' OR model LIKE 'claude-3-%');
