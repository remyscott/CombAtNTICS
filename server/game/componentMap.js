import { HoverSphere } from "./components/HoverSphere.js";
import { Sword } from "./components/Sword.js";
import { Dash } from "./components/Dash.js";
import { addRandomGunToComponentList, BlockMinigun, BlockShinigun, BlockCannon, BlockGunBasic, BlockSniper, BlockSmg, BlockSawedOff, BlockHeavy, BlockShotgun, BlockUltraShotgun, BlockUltraMinigun, BlockUltraUltraShotgun, THE_ULTRA_CANNON } from "./components/BlockGuns.js";
import { SwordBig } from "./components/SwordBig.js";
import { TitaniumCore } from "./components/TitaniumCore.js";

export const componentMap = {
  HoverSphere,
  Sword,
  Dash,
  BlockMinigun,
  SwordBig,
  TitaniumCore,
  BlockShinigun,
  BlockCannon,
  BlockGunBasic,
  BlockSniper,
  BlockSmg,
  BlockSawedOff,
  BlockHeavy,
  BlockShotgun,
  BlockUltraShotgun,
  BlockUltraMinigun,
  BlockUltraUltraShotgun,
  THE_ULTRA_CANNON,
};

export const componentList = Object.keys(componentMap);

export default componentMap;
