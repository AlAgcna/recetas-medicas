-- Perímetro abdominal como signo vital, en centímetros.
-- Aditivo y nullable: las consultas existentes quedan sin el dato y no se
-- inventan mediciones. El IMC no se guarda: se calcula con peso y talla.
ALTER TABLE consultations ADD COLUMN abdominal_perimeter REAL;
