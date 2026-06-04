const objectTypes = {
  pixelsPerMeter: 50,
  objects: {
    "hoverSphere": {
      "imageFile": "hoverSphere.png",
      "pixelsPerMeter": 320,
      "planckConfig": {
        "shape": "circle",
        "radius": 0.5,
        "density": 0.25,
        "friction": 0.5,
        "restitution": 0.2
      }
    },
    "box": {
      "imageFile": "box.png",
      "planckConfig": {
        "shape": "box",
        "halfWidth": 0.5,
        "halfHeight": 0.5,
        "density": 0.25,
        "friction": 0.5,
        "restitution": 0.2
      }
    },
    "circle": {
      "imageFile": "circle.png",
      "planckConfig": {
        "shape": "circle",
        "radius": 0.5,
        "density": 1,
        "friction": 0.5,
        "restitution": 0.9
      }
    },
    "ball": {
      "imageFile": "ball.png",
      "planckConfig": {
        "shape": "circle",
        "radius": 0.5,
        "density": 0.05,
        "friction": 0.5,
        "restitution": 0.5
      }
    },
    "lockbox": {
      "imageFile": "lockbox.png",
      "planckConfig": {
        "shape": "box",
        "halfWidth": 0.5,
        "halfHeight": 0.5,
        "density": 1,
        "friction": 0.5,
        "restitution": 0.2,
        "userData": {
          "damageMultiplier": 1,
          "minDamage": 50
        }
      }
    },
    "softbox": {
      "imageFile": "softbox.png",
      "planckConfig": {
        "shape": "box",
        "halfWidth": 0.5,
        "halfHeight": 0.5,
        "density": 1,
        "friction": 0.5,
        "restitution": 1.1,
        "userData": {
          "damageMultiplier": 0.1,
          "minDamage": 50
        }
      }
    },
    "sword": {
      "imageFile": "sword.png",
      "pixelsPerMeter": 320,
      "planckConfig": {
        "shape": "polygon",
        "vertices": [
          { "x": -.8, "y": 0.22 },
          { "x": -.8, "y": -0.22 },
          { "x": 1.25, "y": -0.22 },
          { "x": 1.45, "y": 0 },
          { "x": 1.25, "y": 0.22 }
        ],
        "density": 0.5,
        "friction": 1,
        "restitution": 0,
        "userData": {
          "damageMultiplier": 2,
          "minDamage": 1,
          "health": 0
        }
      }
    },
    "swordBig": {
      "imageFile": "swordBig.png",
      "pixelsPerMeter": 320,
      "planckConfig": {
        "shape": "polygon",
        "vertices": [
          { "x": -.8, "y": 0.36 },
          { "x": -.8, "y": -0.36 },
          { "x": 1.15, "y": -0.36 },
          { "x": 1.45, "y": 0 },
          { "x": 1.15, "y": 0.36 }
        ],
        "density": 1,
        "friction": 1,
        "restitution": 0,
        "userData": {
          "damageMultiplier": 2,
          "minDamage": 2,
          "health": 0
        }
      }
    },
    "titaniumCore": {
      "imageFile": "titaniumCore.png",
      "pixelsPerMeter": 320,
      "planckConfig": {
        "shape": "box",
        "halfWidth": 0.1,
        "halfHeight": 0.1,
        "density": 80,
        "userData": {
          "depth": 100000
        }
      }
    },
    "dashCore": {
      "imageFile": "dashCore.png",
      "planckConfig": {
        "shape": "box",
        "halfWidth": 0.2,
        "halfHeight": 0.2,
        "density": 1,
        "friction": 0.5,
        "restitution": 0,
        "userData": {
          "depth": 1000
        }
      }
    },
    "spark": {
      "imageFile": "spark.png",
      "planckConfig": {
        "shape": "circle",
        "radius": 0.01,
        "density": 1,
        "friction": 0.5,
        "restitution": 0.9
      }
    },
    "missing": {
      "imageFile": "missing.png",
      "planckConfig": {
        "shape": "box",
        "halfWidth": 0.5,
        "halfHeight": 0.5,
        "density": 0.1,
        "friction": 0.5,
        "restitution": 0.1
      }
    }
  }
};

export function getObjectTypeDefinition(type) {
  return (objectTypes.objects || {})[type] || null;
}

export function getObjectPixelsPerMeter(type) {
  const def = getObjectTypeDefinition(type);
  return (typeof def?.pixelsPerMeter === 'number') ? def.pixelsPerMeter : objectTypes.pixelsPerMeter || 50;
}

export default objectTypes;
