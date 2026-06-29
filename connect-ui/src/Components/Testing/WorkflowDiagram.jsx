import React from "react";
// import ReactFlow, { Controls, Background } from "reactflow";
// import "reactflow/dist/style.css";

const initialNodes = [
  {
    id: "1",
    position: { x: 250, y: 0 },
    data: { label: "If/Else Branch" },
    type: "input",
  },
  {
    id: "2",
    position: { x: 200, y: 100 },
    data: { label: "Leadership Group" },
  },
  {
    id: "3",
    position: { x: 150, y: 200 },
    data: { label: "Request Approval" },
  },
  {
    id: "4",
    position: { x: 50, y: 300 },
    data: { label: "Unassign Office 365 License" },
  },
  {
    id: "5",
    position: { x: 250, y: 300 },
    data: { label: "Request Declined" },
  },
];

const initialEdges = [
  { id: "e1-2", source: "1", target: "2", label: "Approved", animated: false },
  { id: "e1-3", source: "1", target: "3", label: "Declined", animated: false },
  { id: "e3-4", source: "3", target: "4", label: "Approved", animated: false },
  { id: "e3-5", source: "3", target: "5", label: "Declined", animated: false },
];

const WorkflowDiagram = () => {
  return (
    <div style={{ height: "500px", width: "100%" }}>
      {/* <ReactFlow nodes={initialNodes} edges={initialEdges}>
        <Controls />
        <Background />
      </ReactFlow> */}
    </div>
  );
};

export default WorkflowDiagram;
