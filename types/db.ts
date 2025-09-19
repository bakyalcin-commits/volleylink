// types/db.ts
export type Gender = 'male' | 'female';
export type Position = 'S' | 'OH' | 'OPP' | 'MB' | 'L' | 'DS';

export type Profile = {
  id: string | null;
  full_name: string | null;
  gender: Gender | null;
  position: Position | null;
  birth_date: string | null; // ISO
  height_cm: number | null;
  weight_kg: number | null;
  city: string | null;
  country: string | null;
  school: string | null;
  club: string | null;
};

export type VideoRow = {
  id: number;
  user_id: string | null;
  title: string | null;
  storage_path: string;
  public_url: string;
  thumbnail_url: string | null;
  position: Position | null;
  gender: Gender | null;
  city: string | null;
  country: string | null;
  age: number | null;
  full_name: string | null;
  club: string | null;      // ← eklendi
  created_at: string;
};
