import { HoverSphere } from "./components/HoverSphere.js";
import { Sword } from "./components/Sword.js";
import { Dash } from "./components/Dash.js";
import { addRandomGunToComponentList, Minigun, Cannon, GunBasic, Sniper, Smg, SawedOff, Heavy, Shotgun, UltraShotgun, UltraMinigun, UltraUltraShotgun, THE_ULTRA_CANNON } from "./components/Guns.js";
import { SwordBig } from "./components/SwordBig.js";
import { TitaniumCore } from "./components/TitaniumCore.js";

export const componentMap = {
  HoverSphere,
  Sword,
  Dash,
  Minigun,
  SwordBig,
  TitaniumCore,
  Cannon,
  GunBasic,
  Sniper,
  Smg,
  SawedOff,
  Heavy,
  Shotgun,
  UltraShotgun,
  UltraMinigun,
  UltraUltraShotgun,
  THE_ULTRA_CANNON,
};

export const componentList = Object.keys(componentMap);

export default componentMap;
