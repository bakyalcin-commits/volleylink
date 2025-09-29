// lib/positions.ts
import type { Position } from '@/types/db';

export const POSITIONS: { value: Position; label: string }[] = [
  { value: 'S',   label: 'Pasör (S)' },
  { value: 'OPP', label: 'Pasör Çaprazı (OPP)' },
  { value: 'OH',  label: 'Smaçör (OH)' },
  { value: 'MB',  label: 'Orta Oyuncu (MB)' },
  { value: 'L',   label: 'Libero (L)' },
  { value: 'DS',  label: 'Defans Uzmanı (DS)' },
];
