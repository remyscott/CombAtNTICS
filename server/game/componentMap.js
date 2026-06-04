import { HoverSphere } from "./components/HoverSphere.js";
import { Sword } from "./components/Sword.js";
import { Dash } from "./components/Dash.js";
import { SwordBig } from "./components/SwordBig.js";
import { TitaniumCore } from "./components/TitaniumCore.js";

export const componentMap = {
  HoverSphere,
  Sword,
  SwordBig,
  Dash,
  TitaniumCore,
};

export const componentList = Object.keys(componentMap);

export default componentMap;
