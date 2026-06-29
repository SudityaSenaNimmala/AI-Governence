import React from "react";
import SourceMapping from "./SourceMapping";
import DestinationMapping from "./DestinationMapping";
import MappingPairs from "./MappingPairs";

const ContentMapping = () => {
  return (
    <>
      <SourceMapping />
      <MappingPairs />
      <DestinationMapping />
    </>
  );
};

export default ContentMapping;
