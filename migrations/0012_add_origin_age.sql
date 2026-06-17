-- Migration: 0012 - Add origin_age column for phylostrata data
-- Source: Litman & Stein 2019 phylostrata (gene ages from 4.2Bya to 1Mya)

ALTER TABLE proteins ADD COLUMN origin_age TEXT;
