import React, { useState } from "react";
// import { availableMappings, cloudImageMapper } from "../helpers/helpers";
import "./css/Testing.css";
import FolderStructure from "./FolderStructure";
// import Popup from "../Resuables/Popup/Popup";
// import { BsArrowLeft, BsArrowRight } from "react-icons/bs";
// import CalendarDates from "./CalendarDates";

const Testing = () => {
  const options = [
    {
      value: "option1",
      label: "Option 1",
      image: "https://s2cdev.cloudfuze.com/img/PNG/SLACK.png",
    },
    {
      value: "option2",
      label: "Option 2",
      image: "https://s2cdev.cloudfuze.com/img/PNG/GOOGLE_CHAT.png",
    },
    // Add more options as needed
  ];
  const [selectedOption, setSelectedOption] = useState("");

  const handleChange = (event) => {
    setSelectedOption(event.target.value);
    onChange(event.target.value);
  };

  const folderStr = [
    {
      id: "1",
      name: "Folder 1",
      folder: [
        {
          id: "1.1",
          name: "Folder 1.1",
          folder: [
            {
              id: "1.1.1",
              name: "Folder 1.1.1",
              folder: [
                {
                  id: "1.2.1",
                  name: "Folder 1.2.1",
                  folder: [],
                },
                {
                  id: "1.2.2",
                  name: "Folder 1.2.2",
                  folder: [],
                },
                {
                  id: "1.2.3",
                  name: "Folder 1.2.3",
                  folder: [],
                },
              ],
            },
            {
              id: "1.1.2",
              name: "Folder 1.1.2",
              folder: [],
            },
            {
              id: "1.1.3",
              name: "Folder 1.1.3",
              folder: [],
            },
          ],
        },
        {
          id: "1.2",
          name: "Folder 1.2",
          folder: [],
        },
        {
          id: "1.3",
          name: "Folder 1.3",
          folder: [],
        },
      ],
    },
    {
      id: "2",
      name: "Folder 2",
      folder: [],
    },
    {
      id: "3",
      name: "Folder 3",
      folder: [],
    },
  ];

  return (
    <div className="custom-select">
      {/* <select value={selectedOption} onChange={handleChange}>
        <option value="">Select an option</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            <img
              src={option.image}
              alt={option.label}
              className="option-image"
            />
            {option.label}
          </option>
        ))}
      </select> */}

      <FolderStructure folderStr={folderStr} />
    </div>
  );
  // return (
  //   <>
  //     {/* <Popup
  //       options={{
  //         isOpen: true,
  //         title: "Migration Availability",
  //         popupWidth: "100%",
  //         popupHeight: "100vh",
  //       }}
  //     >
  //       <div className="cf_popup_container_body">
  //         {console.log(availableMappings("BOX_BUSINESS"))}
  //         <div className="test_container">
  //           <div className="source">
  //             <div className="dest_icons">
  //               <img
  //                 src={cloudImageMapper(
  //                   availableMappings("BOX_BUSINESS")?.SOURCE
  //                 )}
  //                 alt={availableMappings("BOX_BUSINESS")?.SOURCE}
  //               />
  //               <div className="arrow-right"></div>
  //             </div>
  //           </div>
  //           <div className="destination">
  //             <div className="destination_dist">
  //               {availableMappings("BOX_BUSINESS")?.DESTINATION?.map((data) => {
  //                 return (
  //                   <div className="dest_icons">
  //                     <img src={cloudImageMapper(data)} alt={data} />
  //                     <div className="arrow-left"></div>
  //                   </div>
  //                 );
  //               })}
  //               <div className="destination-arrow"></div>
  //             </div>
  //           </div>
  //         </div>
  //       </div>
  //     </Popup> */}
  //     <div className="cf_calendar">
  //       <div className="cf_calendar_title">
  //         <p>CALENDAR</p>
  //       </div>
  //       <div className="cf_calendar_body">
  //         <div className="cf_calendar_body_container">
  //           <div className="cf_calendar_body_container_title">
  //             <div>
  //               <BsArrowLeft />
  //             </div>
  //             <div>June 2024</div>
  //             <div>
  //               <BsArrowRight />
  //             </div>
  //           </div>
  //           <div className="cf_calendar_body_container_body">
  //             <table>
  //               <thead>
  //                 <tr>
  //                   <th>S</th>
  //                   <th>M</th>
  //                   <th>T</th>
  //                   <th>W</th>
  //                   <th>T</th>
  //                   <th>F</th>
  //                   <th>S</th>
  //                 </tr>
  //               </thead>
  //               {/* <tbody>
  //                 <tr>
  //                   <td></td>
  //                   <td></td>
  //                   <td></td>
  //                   <td></td>
  //                   <td></td>
  //                   <td></td>
  //                   <td>
  //                     <div>1</div>
  //                   </td>
  //                 </tr>
  //                 <tr>
  //                   <td>
  //                     <div>2</div>
  //                   </td>
  //                   <td>
  //                     <div>3</div>
  //                   </td>
  //                   <td>
  //                     <div>4</div>
  //                   </td>
  //                   <td>
  //                     <div>5</div>
  //                   </td>
  //                   <td>
  //                     <div>6</div>
  //                   </td>
  //                   <td>
  //                     <div>7</div>
  //                   </td>
  //                   <td>
  //                     <div>8</div>
  //                   </td>
  //                 </tr>
  //                 <tr>
  //                   <td>
  //                     <div>9</div>
  //                   </td>
  //                   <td>
  //                     <div>10</div>
  //                   </td>
  //                   <td>
  //                     <div>11</div>
  //                   </td>
  //                   <td>
  //                     <div>12</div>
  //                   </td>
  //                   <td>
  //                     <div>13</div>
  //                   </td>
  //                   <td>
  //                     <div>14</div>
  //                   </td>
  //                   <td>
  //                     <div>15</div>
  //                   </td>
  //                 </tr>
  //                 <tr>
  //                   <td>
  //                     <div>16</div>
  //                   </td>
  //                   <td>
  //                     <div>17</div>
  //                   </td>
  //                   <td>
  //                     <div>18</div>
  //                   </td>
  //                   <td>
  //                     <div>19</div>
  //                   </td>
  //                   <td>
  //                     <div>20</div>
  //                   </td>
  //                   <td>
  //                     <div>21</div>
  //                   </td>
  //                   <td>
  //                     <div>22</div>
  //                   </td>
  //                 </tr>
  //                 <tr>
  //                   <td>
  //                     <div>23</div>
  //                   </td>
  //                   <td>
  //                     <div>24</div>
  //                   </td>
  //                   <td>
  //                     <div>25</div>
  //                   </td>
  //                   <td>
  //                     <div>26</div>
  //                   </td>
  //                   <td>
  //                     <div>27</div>
  //                   </td>
  //                   <td>
  //                     <div>28</div>
  //                   </td>
  //                   <td>
  //                     <div>29</div>
  //                   </td>
  //                 </tr>
  //                 <tr>
  //                   <td>
  //                     <div>30</div>
  //                   </td>
  //                   <td></td>
  //                   <td></td>
  //                   <td></td>
  //                   <td></td>
  //                   <td></td>
  //                   <td></td>
  //                 </tr>
  //               </tbody> */}
  //               <CalendarDates />
  //             </table>
  //           </div>
  //         </div>
  //       </div>
  //     </div>
  //   </>
  // );
};

export default Testing;
