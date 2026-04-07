import React from "react";
import { NavLink } from "react-router-dom";

import { TABS } from "../constants";

export default function ProjectTabs({ projectId }) {
  return (
    <div className="tab-nav">
      {TABS.map((tab) => (
        <NavLink
          key={tab}
          to={`/projects/${projectId}/${tab}`}
          className={({ isActive }) => `tab-link ${isActive ? "active" : ""}`}
        >
          {tab}
        </NavLink>
      ))}
    </div>
  );
}
