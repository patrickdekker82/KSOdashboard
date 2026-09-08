-- Wie er verlof en inzet voor een collega mag invullen.
--
-- Dat hing tot nu toe aan de rol: manager of beheerder mocht het, de rest
-- alleen voor zichzelf. In de praktijk is dat te grof. Er is vaak één iemand
-- op de afdeling die de planning bijhoudt zonder manager te zijn, en die moest
-- dan managerrechten krijgen — met alles wat daar verder bij hoort.
--
-- Een eigen vinkje dus, los van de rol. Managers en beheerders houden het
-- recht via hun rol; deze kolom breidt de kring uit en beperkt hem nooit.
ALTER TABLE users ADD COLUMN may_manage_absences INTEGER NOT NULL DEFAULT 0;
